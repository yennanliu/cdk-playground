import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib/core';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

/**
 * LiteLLM AI Gateway on AWS.
 *
 * A single, deliberately simple stack:
 *   VPC -> Aurora PostgreSQL Serverless v2 -> ECS Fargate + ALB (LiteLLM proxy).
 *
 * No Redis (see doc/litellm-gateway-design). Provider API keys are added in the
 * LiteLLM Admin UI after deploy; only the master key, salt key and DB creds are
 * provisioned here. Implements phases 1-5 of the implementation plan.
 *
 * TLS is opt-in: pass `-c domainName=... -c hostedZoneId=... -c zoneName=...`
 * (a Route 53 hosted zone you control) and the ALB serves HTTPS with an
 * auto-provisioned ACM cert + DNS record and an HTTP->HTTPS redirect. Without
 * those context values it serves plain HTTP on :80 (fine for a POC).
 */
export class LiteLlmGatewayStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dbName = 'litellm';
    const containerPort = 4000;

    // ---------------------------------------------------------------------
    // Phase 1 — Network
    // ---------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // ---------------------------------------------------------------------
    // Phase 2 — Data & secrets
    // ---------------------------------------------------------------------
    // Master key (admin auth / UI login) and salt key (encrypts provider keys
    // stored in the DB). Both are generated once; the salt key must never change
    // once provider keys exist, hence RETAIN. The container prefixes the raw
    // generated value with "sk-" at startup (LiteLLM requires that prefix).
    const masterKeySecret = new secretsmanager.Secret(this, 'MasterKeySecret', {
      description: 'LiteLLM master key (raw value; sk- prefix added at runtime)',
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
    });
    const saltKeySecret = new secretsmanager.Secret(this, 'SaltKeySecret', {
      description: 'LiteLLM salt key — encrypts DB-stored provider keys. DO NOT rotate.',
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
    });
    saltKeySecret.applyRemovalPolicy(RemovalPolicy.RETAIN);

    // Aurora PostgreSQL Serverless v2. Credentials are auto-generated into their
    // own Secrets Manager secret; excludeCharacters keeps the password URL-safe
    // so the container can assemble a DATABASE_URL from the parts.
    const dbCredentials = rds.Credentials.fromGeneratedSecret('litellm', {
      excludeCharacters: '/@" \\\'',
    });
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'LiteLLM Aurora — ingress from the Fargate service only',
      allowAllOutbound: false,
    });
    const cluster = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_9,
      }),
      credentials: dbCredentials,
      defaultDatabaseName: dbName,
      writer: rds.ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      storageEncrypted: true,
      removalPolicy: RemovalPolicy.DESTROY, // dev; use SNAPSHOT/RETAIN in prod
    });
    const dbSecret = cluster.secret!;

    // ---------------------------------------------------------------------
    // Phase 3 — Gateway service (ECS Fargate + ALB)
    // ---------------------------------------------------------------------
    const ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const logGroup = new logs.LogGroup(this, 'GatewayLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Phase 5 — optional TLS via a Route 53 hosted zone (see class doc).
    const domainName = this.node.tryGetContext('domainName') as string | undefined;
    const hostedZoneId = this.node.tryGetContext('hostedZoneId') as string | undefined;
    const zoneName = this.node.tryGetContext('zoneName') as string | undefined;
    const useTls = Boolean(domainName && hostedZoneId && zoneName);
    const domainZone = useTls
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
          hostedZoneId: hostedZoneId!,
          zoneName: zoneName!,
        })
      : undefined;

    // The -database image bundles Prisma and runs migrations at startup.
    const image = ecs.ContainerImage.fromRegistry('ghcr.io/berriai/litellm-database:main-stable');

    // Assemble DATABASE_URL / prefixed keys from injected secrets, then exec the
    // proxy. Keeping this in a shell wrapper avoids baking any secret into the
    // task definition or image. No --config: models and provider keys are managed
    // from the Admin UI (STORE_MODEL_IN_DB) — see config/litellm-config.yaml if
    // you prefer to bake a config into a custom image instead.
    const startupCommand = [
      'export DATABASE_URL="postgresql://${DATABASE_USERNAME}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}"',
      'export LITELLM_MASTER_KEY="sk-${MASTER_KEY_RANDOM}"',
      'export LITELLM_SALT_KEY="sk-${SALT_KEY_RANDOM}"',
      `exec litellm --port ${containerPort} --num_workers 2`,
    ].join('\n');

    const gateway = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Gateway', {
      cluster: ecsCluster,
      cpu: 1024,
      memoryLimitMiB: 2048,
      desiredCount: 2,
      publicLoadBalancer: true, // set false for a VPC-only gateway
      // HTTPS with an auto-provisioned ACM cert + DNS record + HTTP->HTTPS
      // redirect when a hosted zone is supplied; plain HTTP otherwise.
      ...(useTls
        ? {
            protocol: elbv2.ApplicationProtocol.HTTPS,
            domainName,
            domainZone,
            redirectHTTP: true,
          }
        : { listenerPort: 80 }),
      // Give tasks time to run DB migrations before health checks can fail them.
      healthCheckGracePeriod: Duration.seconds(180),
      taskImageOptions: {
        image,
        containerPort,
        entryPoint: ['/bin/sh', '-c'],
        command: [startupCommand],
        enableLogging: true,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'litellm', logGroup }),
        environment: {
          DATABASE_HOST: cluster.clusterEndpoint.hostname,
          DATABASE_PORT: cluster.clusterEndpoint.port.toString(),
          DATABASE_NAME: dbName,
          STORE_MODEL_IN_DB: 'True',
        },
        secrets: {
          DATABASE_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
          MASTER_KEY_RANDOM: ecs.Secret.fromSecretsManager(masterKeySecret),
          SALT_KEY_RANDOM: ecs.Secret.fromSecretsManager(saltKeySecret),
        },
      },
    });

    // LiteLLM's unauthenticated liveness probe.
    gateway.targetGroup.configureHealthCheck({
      path: '/health/liveliness',
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(10),
    });

    // Let the service reach Aurora on 5432.
    cluster.connections.allowDefaultPortFrom(
      gateway.service,
      'LiteLLM Fargate service to Aurora',
    );

    // Task role: invoke Bedrock models directly via IAM (no API keys needed).
    gateway.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );

    // ---------------------------------------------------------------------
    // Phase 4 — Scaling & observability
    // ---------------------------------------------------------------------
    // Horizontal autoscaling on CPU; stateless tasks make this safe.
    const scaling = gateway.service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.seconds(120),
      scaleOutCooldown: Duration.seconds(60),
    });

    // Alarms notify this topic — subscribe an email/Slack endpoint post-deploy.
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'LiteLLM gateway alarms',
    });
    const alarmAction = new cw_actions.SnsAction(alarmTopic);
    const addAlarm = (id: string, metric: cloudwatch.Metric, threshold: number): void => {
      const alarm = metric.createAlarm(this, id, {
        threshold,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(alarmAction);
    };

    addAlarm('UnhealthyHostsAlarm', gateway.targetGroup.metrics.unhealthyHostCount(), 0);
    addAlarm(
      'Alb5xxAlarm',
      gateway.targetGroup.metrics.httpCodeTarget(
        elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
        { period: Duration.minutes(1), statistic: 'Sum' },
      ),
      10,
    );
    addAlarm('ServiceCpuAlarm', gateway.service.metricCpuUtilization(), 85);
    addAlarm('ServiceMemoryAlarm', gateway.service.metricMemoryUtilization(), 85);
    addAlarm('DbConnectionsAlarm', cluster.metricDatabaseConnections(), 200);

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------
    const baseUrl = useTls
      ? `https://${domainName}`
      : `http://${gateway.loadBalancer.loadBalancerDnsName}`;
    new CfnOutput(this, 'GatewayUrl', {
      value: baseUrl,
      description: 'LiteLLM gateway base URL (OpenAI-compatible endpoint)',
    });
    new CfnOutput(this, 'AdminUiUrl', {
      value: `${baseUrl}/ui`,
      description: 'LiteLLM Admin UI — log in with the master key',
    });
    new CfnOutput(this, 'MasterKeySecretArn', {
      value: masterKeySecret.secretArn,
      description: 'Secret holding the raw master key value (actual key = "sk-" + value)',
    });
    new CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic for gateway alarms — subscribe an endpoint to receive them',
    });
  }
}
