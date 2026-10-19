import { execFileSync, execSync } from 'child_process';
import * as path from 'path';
import { ArnFormat, CfnOutput, DockerImage, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';

const APP_DIR = path.join(__dirname, '..', 'app');

/** Where AgentCore Memory files what it extracts. Must match `MEMORY_NAMESPACES` in app/muse/config.py. */
export const MEMORY_NAMESPACES = { facts: '/users/{actorId}/facts', preferences: '/users/{actorId}/preferences' };

export interface MuseTest3StackProps extends StackProps {
  /** Bedrock inference profile ID for the agent, e.g. `global.anthropic.claude-sonnet-5-5`. */
  readonly bedrockModelId?: string;
  /** Domains the agent may browse without asking first. Everything else needs the user's approval. */
  readonly allowedDomains?: string[];
}

/**
 * Approach C of `doc/build-your-own-muse.md`: serverless, with Amazon Bedrock
 * AgentCore doing the hard parts.
 *
 *   browser ─► HTTP API (Cognito JWT) ─► api λ ─async─► worker λ ─► AgentCore Runtime (microVM per user session)
 *                                                          ▲            ├─► Bedrock (Claude)
 *                       EventBridge Scheduler (tasks) ─────┘            ├─► AgentCore Memory (history + long-term)
 *                                                                       └─► sentinel λ ─► AgentCore Browser
 *
 * The runtime's role can call the model, use Memory and invoke the sentinel --
 * nothing else. Browsing and scheduling exist only behind the sentinel, which
 * checks the user's approvals and audits every action.
 */
export class MuseTest3Stack extends Stack {
  constructor(scope: Construct, id: string, props: MuseTest3StackProps = {}) {
    super(scope, id, props);

    const modelId = props.bedrockModelId ?? 'global.anthropic.claude-sonnet-5-5';
    // AgentCore names allow only [a-zA-Z0-9_].
    const name = this.stackName.replace(/[^A-Za-z0-9_]/g, '_');

    // One bundle (arm64 wheels + app) for the runtime and every Lambda. CDK stages
    // identical assets once, so it is built and uploaded a single time.
    const bundle: s3assets.AssetOptions = {
      exclude: ['.venv', '.pytest_cache', '.ruff_cache', '**/__pycache__', 'tests'],
      bundling: {
        // Docker is only the fallback for machines without uv.
        image: DockerImage.fromRegistry('ghcr.io/astral-sh/uv:0.11.8-python3.13-bookworm-slim'),
        command: ['bash', '/asset-input/bundle.sh', '/asset-output'],
        environment: { UV_CACHE_DIR: '/tmp/uv-cache' },
        local: {
          tryBundle(outputDir: string) {
            try {
              execSync('uv --version', { stdio: 'ignore' });
            } catch {
              return false;
            }
            execFileSync(path.join(APP_DIR, 'bundle.sh'), [outputDir], { stdio: 'inherit' });
            return true;
          },
        },
      },
    };
    const code = new s3assets.Asset(this, 'Code', { path: APP_DIR, ...bundle });

    // --- state ------------------------------------------------------------------
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'user', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expires',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const memory = new agentcore.CfnMemory(this, 'Memory', {
      name: `${name}_memory`,
      description: 'Muse conversation history and long-term memory, one actor per user',
      eventExpiryDuration: 30,
      memoryStrategies: [
        { semanticMemoryStrategy: { name: 'facts', namespaces: [MEMORY_NAMESPACES.facts] } },
        { userPreferenceMemoryStrategy: { name: 'preferences', namespaces: [MEMORY_NAMESPACES.preferences] } },
      ],
    });
    memory.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const tasks = new scheduler.ScheduleGroup(this, 'Tasks', { removalPolicy: RemovalPolicy.DESTROY });

    // --- Lambdas ------------------------------------------------------------------
    const pyFunction = (id: string, props: Pick<lambda.FunctionProps, 'handler' | 'timeout' | 'functionName'>,
      environment: Record<string, string>) =>
      new lambda.Function(this, id, {
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: lambda.Architecture.ARM_64,
        code: lambda.Code.fromAsset(APP_DIR, bundle),
        memorySize: 512,
        environment: { MUSE_TABLE: table.tableName, ...environment },
        ...props,
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });

    // Runs one agent turn. Never retried: a retry could repeat the agent's actions.
    // A fixed name, so the sentinel can target it by ARN without a reference cycle
    // (worker -> runtime -> runtime role -> sentinel -> worker).
    const workerName = `${this.stackName}-worker`;
    const worker = pyFunction(
      'Worker',
      { handler: 'muse.worker.handler', timeout: Duration.minutes(15), functionName: workerName },
      {},
    );
    worker.configureAsyncInvoke({ retryAttempts: 0 });

    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
      description: 'EventBridge Scheduler fires Muse background tasks on the worker',
    });
    worker.grantInvoke(schedulerRole);
    const taskEnv = {
      MUSE_WORKER_ARN: this.formatArn({
        service: 'lambda',
        resource: 'function',
        resourceName: workerName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      }),
      MUSE_SCHEDULE_GROUP: tasks.scheduleGroupName,
      MUSE_SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
    };
    const grantTasks = (fn: lambda.Function) => {
      tasks.grantWriteSchedules(fn);
      tasks.grantDeleteSchedules(fn);
      schedulerRole.grantPassRole(fn.grantPrincipal);
    };

    // The only way the agent acts: browse (AgentCore Browser) and schedule tasks, after policy checks.
    const sentinel = pyFunction('Sentinel', { handler: 'muse.sentinel.handler', timeout: Duration.minutes(2) }, {
      ...taskEnv,
      MUSE_ALLOWED_DOMAINS: (props.allowedDomains ?? []).join(','),
    });
    table.grantReadWriteData(sentinel);
    grantTasks(sentinel);
    sentinel.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:StartBrowserSession',
          'bedrock-agentcore:GetBrowserSession',
          'bedrock-agentcore:StopBrowserSession',
          'bedrock-agentcore:ConnectBrowserAutomationStream',
        ],
        // The AWS-managed browser: a fresh, isolated Chromium per session.
        resources: [`arn:${this.partition}:bedrock-agentcore:${this.region}:aws:browser/aws.browser.v1`],
      }),
    );

    // --- AgentCore Runtime --------------------------------------------------------
    const runtimeRole = new iam.Role(this, 'RuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:*` },
        },
      }),
      description: 'Muse agent: the model, its Memory, and the sentinel -- nothing else',
    });
    runtimeRole.addToPolicy(bedrockInvoke(this, modelId));
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:GetMemory',
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:GetEvent',
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:ListSessions',
          'bedrock-agentcore:RetrieveMemoryRecords',
        ],
        resources: [memory.attrMemoryArn],
      }),
    );
    sentinel.grantInvoke(runtimeRole);
    // What every AgentCore Runtime needs: its logs, traces and metrics, and its workload identity.
    const runtimeLogs = `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`;
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        resources: [runtimeLogs, `${runtimeLogs}:*`],
      }),
    );
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
        resources: ['*'],
      }),
    );
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
      }),
    );
    const identity = `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default`;
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:GetWorkloadAccessToken', 'bedrock-agentcore:GetWorkloadAccessTokenForUserId'],
        resources: [identity, `${identity}/workload-identity/*`],
      }),
    );

    const runtime = new agentcore.CfnRuntime(this, 'Runtime', {
      agentRuntimeName: `${name}_agent`,
      description: 'Muse agent (Strands), one microVM per user session',
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: { s3: { bucket: code.s3BucketName, prefix: code.s3ObjectKey } },
          entryPoint: ['main.py'],
          runtime: 'PYTHON_3_13',
        },
      },
      networkConfiguration: { networkMode: 'PUBLIC' },
      protocolConfiguration: 'HTTP',
      roleArn: runtimeRole.roleArn,
      environmentVariables: {
        AWS_REGION: this.region,
        MUSE_MODEL_ID: modelId,
        MUSE_MEMORY_ID: memory.attrMemoryId,
        MUSE_SENTINEL_ARN: sentinel.functionArn,
      },
    });
    // AgentCore checks the role when the runtime is created, so its policy must exist first.
    runtime.node.addDependency(runtimeRole);

    worker.addEnvironment('MUSE_RUNTIME_ARN', runtime.attrAgentRuntimeArn);
    table.grantReadWriteData(worker);
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        // The runtime and its endpoints (DEFAULT is the one invoked).
        resources: [runtime.attrAgentRuntimeArn, `${runtime.attrAgentRuntimeArn}/*`],
      }),
    );

    // --- API ------------------------------------------------------------------------
    const users = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const webClient = users.addClient('Web', { authFlows: { userPassword: true }, generateSecret: false });

    const api = pyFunction('Api', { handler: 'muse.api.handler', timeout: Duration.seconds(29) }, {
      ...taskEnv,
      MUSE_MEMORY_ID: memory.attrMemoryId,
      MUSE_USER_POOL_CLIENT_ID: webClient.userPoolClientId,
    });
    table.grantReadWriteData(api);
    grantTasks(api);
    worker.grantInvoke(api);
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:ListMemoryRecords',
          'bedrock-agentcore:GetMemoryRecord',
          'bedrock-agentcore:DeleteMemoryRecord',
        ],
        resources: [memory.attrMemoryArn],
      }),
    );

    const integration = new HttpLambdaIntegration('Api', api);
    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      description: 'Muse: web UI and JSON API',
      defaultIntegration: integration,
      defaultAuthorizer: new HttpUserPoolAuthorizer('Users', users, { userPoolClients: [webClient] }),
    });
    // The page itself is public; it signs in with Cognito and sends the token on every call.
    httpApi.addRoutes({
      path: '/',
      methods: [apigw.HttpMethod.GET],
      integration,
      authorizer: new apigw.HttpNoneAuthorizer(),
    });

    new CfnOutput(this, 'Url', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: users.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: webClient.userPoolClientId });
    new CfnOutput(this, 'RuntimeArn', { value: runtime.attrAgentRuntimeArn });
    new CfnOutput(this, 'MemoryId', { value: memory.attrMemoryId });
    new CfnOutput(this, 'CreateUserCommand', {
      description: 'Create a user (replace EMAIL and PASSWORD), then sign in at Url',
      value:
        `aws cognito-idp admin-create-user --region ${this.region} --user-pool-id ${users.userPoolId} ` +
        `--username EMAIL --message-action SUPPRESS && ` +
        `aws cognito-idp admin-set-user-password --region ${this.region} --user-pool-id ${users.userPoolId} ` +
        `--username EMAIL --password PASSWORD --permanent`,
    });
  }
}

/**
 * Permission to call one model on Bedrock.
 *
 * Current Claude models are invoked through an inference profile (the model ID
 * prefixed with a geography such as `global.` or `jp.`), which needs permission
 * on both the profile and the foundation model -- in whichever region the
 * profile routes to, hence the wildcard region. Bare IDs need only the model.
 */
export function bedrockInvoke(stack: Stack, modelId: string): iam.PolicyStatement {
  const foundationModelId = modelId.replace(/^(global|us|eu|apac|jp)\./, '');
  return new iam.PolicyStatement({
    actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
    resources: [
      `arn:${stack.partition}:bedrock:*::foundation-model/${foundationModelId}`,
      ...(foundationModelId !== modelId
        ? [`arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${modelId}`]
        : []),
    ],
  });
}
