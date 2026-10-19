import * as cdk from 'aws-cdk-lib/core';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { MEMORY_NAMESPACES, MuseTest3Stack, MuseTest3StackProps, bedrockInvoke } from '../lib/muse-test-3-stack';

const ENV = { account: '123456789012', region: 'ap-northeast-1' };

function synth(props: Partial<MuseTest3StackProps> = {}) {
  // Skip the uv bundling: these tests are about the template, not the zip.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new MuseTest3Stack(app, 'TestStack', { env: ENV, ...props });
  return { stack, template: Template.fromStack(stack) };
}

const { template } = synth();

/** Logical ID of the single resource of `type` whose ID starts with `prefix`. */
function logicalId(type: string, prefix: string): string {
  const ids = Object.keys(template.findResources(type)).filter((id) => id.startsWith(prefix));
  expect(ids).toHaveLength(1);
  return ids[0];
}

/** All IAM statements attached to the role with this logical-ID prefix. */
function statementsOf(rolePrefix: string): any[] {
  const role = logicalId('AWS::IAM::Role', rolePrefix);
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === role))
    .flatMap((p: any) => p.Properties.PolicyDocument.Statement);
}

const actionsOf = (rolePrefix: string) => statementsOf(rolePrefix).flatMap((s) => [s.Action].flat());

function functionEnv(prefix: string): Record<string, any> {
  return template.findResources('AWS::Lambda::Function')[logicalId('AWS::Lambda::Function', prefix)].Properties
    .Environment.Variables;
}

describe('AgentCore', () => {
  test('runtime runs the bundled code with Python 3.13, entry main.py', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      AgentRuntimeName: 'TestStack_agent',
      AgentRuntimeArtifact: {
        CodeConfiguration: {
          Code: { S3: { Bucket: Match.anyValue(), Prefix: Match.stringLikeRegexp('\\.zip$') } },
          EntryPoint: ['main.py'],
          Runtime: 'PYTHON_3_13',
        },
      },
      NetworkConfiguration: { NetworkMode: 'PUBLIC' },
      EnvironmentVariables: Match.objectLike({
        MUSE_MODEL_ID: 'global.anthropic.claude-sonnet-5-5',
        MUSE_MEMORY_ID: { 'Fn::GetAtt': [logicalId('AWS::BedrockAgentCore::Memory', 'Memory'), 'MemoryId'] },
        MUSE_SENTINEL_ARN: { 'Fn::GetAtt': [logicalId('AWS::Lambda::Function', 'Sentinel'), 'Arn'] },
      }),
    });
  });

  test('runtime is created after its role policy', () => {
    const runtime = Object.values(template.findResources('AWS::BedrockAgentCore::Runtime'))[0] as any;
    expect(runtime.DependsOn.some((d: string) => d.startsWith('RuntimeRoleDefaultPolicy'))).toBe(true);
  });

  test('memory extracts facts and preferences per user', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Memory', {
      Name: 'TestStack_memory',
      MemoryStrategies: [
        { SemanticMemoryStrategy: { Name: 'facts', Namespaces: ['/users/{actorId}/facts'] } },
        { UserPreferenceMemoryStrategy: { Name: 'preferences', Namespaces: ['/users/{actorId}/preferences'] } },
      ],
    });
  });

  test('memory namespaces match the Python app', () => {
    const python = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'muse', 'config.py'), 'utf8');
    for (const ns of Object.values(MEMORY_NAMESPACES)) expect(python).toContain(`"${ns}"`);
  });

  test('stack names with dashes still make valid AgentCore names', () => {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
    const t = Template.fromStack(new MuseTest3Stack(app, 'muse-dev', { env: ENV }));
    t.hasResourceProperties('AWS::BedrockAgentCore::Runtime', { AgentRuntimeName: 'muse_dev_agent' });
    t.hasResourceProperties('AWS::BedrockAgentCore::Memory', { Name: 'muse_dev_memory' });
  });
});

describe('least privilege', () => {
  test('the agent can call its model, use its memory and invoke the sentinel -- and cannot act itself', () => {
    const actions = actionsOf('RuntimeRole');
    expect(actions).toEqual(expect.arrayContaining([
      'bedrock:InvokeModel',
      'bedrock-agentcore:RetrieveMemoryRecords',
      'bedrock-agentcore:CreateEvent',
      'lambda:InvokeFunction',
    ]));
    for (const forbidden of [/Browser/, /^dynamodb:/, /^scheduler:/, /^iam:PassRole$/, /DeleteMemoryRecord/, /DeleteEvent/]) {
      expect(actions.filter((a) => forbidden.test(a))).toEqual([]);
    }
  });

  test('the agent may invoke only the sentinel', () => {
    const invoke = statementsOf('RuntimeRole').filter((s) => [s.Action].flat().includes('lambda:InvokeFunction'));
    const sentinel = logicalId('AWS::Lambda::Function', 'Sentinel');
    const targets = invoke.flatMap((s) => [s.Resource].flat()).map((r) => JSON.stringify(r));
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t).toContain(sentinel);
  });

  test('only the sentinel can use AgentCore Browser, and only the AWS-managed one', () => {
    for (const role of ['RuntimeRole', 'WorkerServiceRole', 'ApiServiceRole']) {
      expect(actionsOf(role).filter((a) => /Browser/.test(a))).toEqual([]);
    }
    const browser = statementsOf('SentinelServiceRole').find((s) => [s.Action].flat().includes('bedrock-agentcore:StartBrowserSession'));
    expect(JSON.stringify(browser.Resource)).toContain(':aws:browser/aws.browser.v1');
  });

  test('only the worker invokes the runtime', () => {
    expect(actionsOf('WorkerServiceRole')).toContain('bedrock-agentcore:InvokeAgentRuntime');
    for (const role of ['RuntimeRole', 'SentinelServiceRole', 'ApiServiceRole']) {
      expect(actionsOf(role)).not.toContain('bedrock-agentcore:InvokeAgentRuntime');
    }
  });

  test('the API can forget memories; nobody else can', () => {
    expect(actionsOf('ApiServiceRole')).toContain('bedrock-agentcore:DeleteMemoryRecord');
    for (const role of ['RuntimeRole', 'SentinelServiceRole', 'WorkerServiceRole']) {
      expect(actionsOf(role)).not.toContain('bedrock-agentcore:DeleteMemoryRecord');
    }
  });

  test('runtime role trusts AgentCore from this account only', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [Match.objectLike({
          Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
          Condition: Match.objectLike({ StringEquals: { 'aws:SourceAccount': '123456789012' } }),
        })],
      },
    });
  });

  test('no IAM statement grants a wildcard action', () => {
    const all = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement,
    );
    for (const s of all) for (const a of [s.Action].flat()) expect(a).not.toMatch(/(^\*$|:\*$)/);
  });
});

describe('worker and tasks', () => {
  test('worker has a fixed name, 15 minutes, and is never retried', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'TestStack-worker',
      Handler: 'muse.worker.handler',
      Timeout: 900,
      Architectures: ['arm64'],
      Runtime: 'python3.13',
    });
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', { MaximumRetryAttempts: 0 });
  });

  test('sentinel and API target the worker by its ARN', () => {
    for (const fn of ['Sentinel', 'Api']) {
      expect(JSON.stringify(functionEnv(fn).MUSE_WORKER_ARN)).toContain(':lambda:ap-northeast-1:123456789012:function:TestStack-worker');
    }
  });

  test('scheduler role may invoke only the worker', () => {
    const invoke = statementsOf('SchedulerRole').flatMap((s) => [s.Resource].flat()).map((r) => JSON.stringify(r));
    const worker = logicalId('AWS::Lambda::Function', 'Worker');
    for (const r of invoke) expect(r).toContain(worker);
  });

  test('sentinel and API can create schedules and pass the scheduler role', () => {
    for (const role of ['SentinelServiceRole', 'ApiServiceRole']) {
      expect(actionsOf(role)).toEqual(expect.arrayContaining(['scheduler:CreateSchedule', 'scheduler:DeleteSchedule', 'iam:PassRole']));
    }
  });

  test('allowed domains reach the sentinel', () => {
    const { template: t } = synth({ allowedDomains: ['wikipedia.org', 'example.com'] });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'muse.sentinel.handler',
      Environment: { Variables: Match.objectLike({ MUSE_ALLOWED_DOMAINS: 'wikipedia.org,example.com' }) },
    });
  });
});

describe('API', () => {
  test('every route needs a Cognito JWT except the page itself', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((r: any) => r.Properties);
    expect(routes.map((r) => [r.RouteKey, r.AuthorizationType]).sort()).toEqual([
      ['$default', 'JWT'],
      ['GET /', 'NONE'],
    ]);
  });

  test('users cannot sign themselves up', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']),
      GenerateSecret: false,
    });
  });

  test('API stays under API Gateway\'s 30 s limit', () => {
    template.hasResourceProperties('AWS::Lambda::Function', { Handler: 'muse.api.handler', Timeout: 29 });
  });
});

test('table keys by user, with TTL', () => {
  template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
    KeySchema: [{ AttributeName: 'user', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    TimeToLiveSpecification: { AttributeName: 'expires', Enabled: true },
  });
});

test('all functions share one code asset with the runtime', () => {
  const keys = new Set(
    Object.values(template.findResources('AWS::Lambda::Function'))
      .filter((f: any) => f.Properties.Handler?.startsWith('muse.'))
      .map((f: any) => f.Properties.Code.S3Key),
  );
  const runtime = Object.values(template.findResources('AWS::BedrockAgentCore::Runtime'))[0] as any;
  expect([...keys]).toEqual([runtime.Properties.AgentRuntimeArtifact.CodeConfiguration.Code.S3.Prefix]);
});

test('outputs the URL and how to create a user', () => {
  for (const o of ['Url', 'UserPoolId', 'UserPoolClientId', 'RuntimeArn', 'MemoryId', 'CreateUserCommand']) {
    template.hasOutput(o, {});
  }
});

test('synthesizes without errors or warnings', () => {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const annotations = Annotations.fromStack(new MuseTest3Stack(app, 'TestStack', { env: ENV }));
  expect(annotations.findError('*', Match.anyValue())).toEqual([]);
  expect(annotations.findWarning('*', Match.anyValue())).toEqual([]);
});

describe('bedrockInvoke', () => {
  const stack = new cdk.Stack(new cdk.App(), 'S', { env: ENV });
  const resources = (id: string) => JSON.stringify(stack.resolve(bedrockInvoke(stack, id).resources));

  test('inference profile grants the profile and its foundation model in any region', () => {
    const r = resources('jp.anthropic.claude-haiku-5-5');
    expect(r).toContain(':bedrock:*::foundation-model/anthropic.claude-haiku-5-5');
    expect(r).toContain(':bedrock:ap-northeast-1:123456789012:inference-profile/jp.anthropic.claude-haiku-5-5');
  });

  test('bare model ID grants only the foundation model', () => {
    expect(resources('amazon.titan-embed-text-v2:0')).not.toContain('inference-profile');
  });
});
