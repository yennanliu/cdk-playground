import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

const APP_DIR = path.join(__dirname, '..', 'app');
const NAMESPACE = 'muse.internal';
/** Must match the ports in app/muse/sentinel.py. */
export const SENTINEL_PORTS = { gateway: 8081, proxy: 3128 };
const EMBED_MODEL_ID = 'amazon.titan-embed-text-v2:0';

export interface MuseTest4StackProps extends StackProps {
  /** Bedrock inference profile ID for the agent, e.g. `global.anthropic.claude-sonnet-5-5`. */
  readonly bedrockModelId?: string;
  /** Domains every user may browse without being asked. Everything else needs the user's approval. */
  readonly allowedDomains?: string[];
  /** A sandbox stops itself after this long with nothing to do. */
  readonly idleMinutes?: number;
}

/**
 * Approach D of `doc/build-your-own-muse.md`: ECS Fargate, one sandbox task per active user.
 *
 *   browser ─► CloudFront ─► internal ALB ─► api (UI, JSON API, session manager, scheduler)
 *                                              │ RunTask, one per user
 *                                              ▼
 *     isolated subnet (no route out) ─ sandbox task: agent + Chromium ──► sentinel ──► NAT ──► Bedrock, the web
 *                                                                          (gateway + egress proxy)
 *
 * Only the api and the sentinel can touch the table. A sandbox's role can call
 * the model and nothing else, and its only network peer is the sentinel, which
 * checks every connection against that user's approvals.
 */
export class MuseTest4Stack extends Stack {
  constructor(scope: Construct, id: string, props: MuseTest4StackProps = {}) {
    super(scope, id, props);

    const modelId = props.bedrockModelId ?? 'global.anthropic.claude-sonnet-5-5';

    // --- network ---------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        // Sandboxes: no NAT, no internet gateway. The sentinel is their way out.
        { name: 'sandbox', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 22 },
      ],
    });
    const sandboxSubnets = vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED });
    vpc.addGatewayEndpoint('DynamoDb', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });
    // What Fargate itself needs to start a task in the isolated subnets: pull the image, ship logs.
    vpc.addGatewayEndpoint('S3', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });
    const endpoints = [
      ec2.InterfaceVpcEndpointAwsService.ECR,
      ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    ].map((service, i) =>
      vpc.addInterfaceEndpoint(['EcrApi', 'EcrDocker', 'Logs'][i], {
        service,
        // One AZ is enough (any AZ can reach it) and halves the hourly cost.
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED, availabilityZones: [vpc.availabilityZones[0]] },
      }),
    );

    const sandboxSg = new ec2.SecurityGroup(this, 'SandboxSg', {
      vpc,
      description: 'Muse sandboxes: no inbound; out only to the sentinel and the image/log endpoints',
      allowAllOutbound: false,
    });
    for (const endpoint of endpoints) endpoint.connections.allowDefaultPortFrom(sandboxSg);
    const s3 = ec2.PrefixList.fromLookup(this, 'S3PrefixList', { prefixListName: `com.amazonaws.${this.region}.s3` });
    sandboxSg.addEgressRule(ec2.Peer.prefixList(s3.prefixListId), ec2.Port.tcp(443), 'image layers (S3 gateway endpoint)');

    // --- state and users -------------------------------------------------------------------
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'user', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expires',
      // Sparse: only tasks carry `due`. The scheduler reads every user's due tasks from it.
      globalSecondaryIndexes: [
        {
          indexName: 'due',
          partitionKey: { name: 'due', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'next_run', type: dynamodb.AttributeType.NUMBER },
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const users = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const webClient = users.addClient('Web', { authFlows: { userPassword: true }, generateSecret: false });

    // --- one image, three roles ---------------------------------------------------------------
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      defaultCloudMapNamespace: { name: NAMESPACE, useForServiceConnect: false },
    });
    const image = ecs.ContainerImage.fromAsset(APP_DIR, { platform: Platform.LINUX_ARM64 });
    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const taskDefinition = (
      id: string,
      size: { cpu: number; memoryLimitMiB: number },
      command: string[],
      environment: Record<string, string>,
      portMappings: ecs.PortMapping[] = [],
    ) => {
      const definition = new ecs.FargateTaskDefinition(this, id, {
        ...size,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      definition.addContainer(id.toLowerCase(), {
        image,
        command,
        environment: { AWS_REGION: this.region, ...environment },
        portMappings,
        logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: id.toLowerCase() }),
      });
      return definition;
    };

    // The sandbox: started per user by the api, never as a service.
    const sandbox = taskDefinition('Sandbox', { cpu: 1024, memoryLimitMiB: 2048 }, ['python', '-m', 'muse.sandbox'], {
      MUSE_MODEL_ID: modelId,
      MUSE_GATEWAY_URL: `http://sentinel.${NAMESPACE}:${SENTINEL_PORTS.gateway}`,
      MUSE_PROXY_URL: `http://sentinel.${NAMESPACE}:${SENTINEL_PORTS.proxy}`,
      MUSE_IDLE_SECONDS: String((props.idleMinutes ?? 10) * 60),
    });
    sandbox.taskRole.addToPrincipalPolicy(bedrockInvoke(this, modelId));

    // The sentinel: gateway + egress proxy, found by sandboxes as sentinel.muse.internal.
    const sentinel = new ecs.FargateService(this, 'SentinelService', {
      cluster,
      taskDefinition: taskDefinition(
        'Sentinel',
        { cpu: 512, memoryLimitMiB: 1024 },
        ['python', '-m', 'muse.sentinel'],
        {
          MUSE_TABLE: table.tableName,
          MUSE_EMBED_MODEL_ID: EMBED_MODEL_ID,
          MUSE_ALLOWED_DOMAINS: (props.allowedDomains ?? []).join(','),
        },
        [{ containerPort: SENTINEL_PORTS.gateway }, { containerPort: SENTINEL_PORTS.proxy }],
      ),
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: { name: 'sentinel' },
      minHealthyPercent: 100,
      circuitBreaker: { rollback: true },
    });
    table.grantReadWriteData(sentinel.taskDefinition.taskRole);
    sentinel.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:${this.partition}:bedrock:${this.region}::foundation-model/${EMBED_MODEL_ID}`],
      }),
    );
    for (const port of Object.values(SENTINEL_PORTS)) {
      sentinel.connections.allowFrom(sandboxSg, ec2.Port.tcp(port), 'sandboxes');
    }

    // The api: UI, JSON API, session manager and scheduler.
    const api = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: taskDefinition(
        'Api',
        { cpu: 512, memoryLimitMiB: 1024 },
        ['python', '-m', 'muse.api'],
        {
          MUSE_TABLE: table.tableName,
          MUSE_USER_POOL_ID: users.userPoolId,
          MUSE_USER_POOL_CLIENT_ID: webClient.userPoolClientId,
          MUSE_LAUNCHER: 'ecs',
          MUSE_CLUSTER: cluster.clusterName,
          MUSE_SANDBOX_TASK_DEFINITION: sandbox.taskDefinitionArn,
          MUSE_SANDBOX_SUBNETS: sandboxSubnets.subnetIds.join(','),
          MUSE_SANDBOX_SECURITY_GROUPS: sandboxSg.securityGroupId,
        },
        [{ containerPort: 8080 }],
      ),
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      minHealthyPercent: 100,
      circuitBreaker: { rollback: true },
    });
    const apiRole = api.taskDefinition.taskRole;
    table.grantReadWriteData(apiRole);
    sandbox.grantRun(apiRole);
    apiRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:StopTask'],
        resources: [`arn:${this.partition}:ecs:${this.region}:${this.account}:task/${cluster.clusterName}/*`],
      }),
    );

    // --- ingress: CloudFront (HTTPS) ─► internal ALB ─► api ------------------------------------------
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
    const cloudfrontOrigins = ec2.PrefixList.fromLookup(this, 'CloudFrontPrefixList', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    const listener = alb.addListener('Http', { port: 80, open: false });
    alb.connections.allowFrom(ec2.Peer.prefixList(cloudfrontOrigins.prefixListId), ec2.Port.tcp(80), 'CloudFront');
    listener.addTargets('Api', {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: { path: '/health', interval: Duration.seconds(15) },
      deregistrationDelay: Duration.seconds(10),
    });

    const cdn = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Muse: web UI and JSON API',
      defaultBehavior: {
        origin: origins.VpcOrigin.withApplicationLoadBalancer(alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Every viewer header, including Authorization (the Cognito token), reaches the api.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });

    new CfnOutput(this, 'Url', { value: `https://${cdn.distributionDomainName}` });
    new CfnOutput(this, 'UserPoolId', { value: users.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: webClient.userPoolClientId });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'LogGroup', { value: logGroup.logGroupName });
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
