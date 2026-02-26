import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as path from 'path';

export class ClaudeInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = this.node.tryGetContext('env') || 'dev';

    // Create VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'ClaudeVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'ClaudeCluster', {
      vpc: vpc,
      clusterName: `${env}-claude-cluster`,
      containerInsights: true,
    });

    // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'ClaudeLogGroup', {
      logGroupName: `/ecs/${env}-claude-code`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create EFS for persistent workspace storage
    const fileSystem = new efs.FileSystem(this, 'ClaudeWorkspaceFS', {
      vpc: vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      fileSystemName: `${env}-claude-workspace`,
    });

    // Create EFS Access Point for workspace
    const accessPoint = new efs.AccessPoint(this, 'ClaudeWorkspaceAP', {
      fileSystem: fileSystem,
      path: '/workspace',
      posixUser: {
        uid: '1001',
        gid: '1001',
      },
      createAcl: {
        ownerUid: '1001',
        ownerGid: '1001',
        permissions: '755',
      },
    });

    // Create secret for Anthropic API Key
    const apiKeySecret = new secretsmanager.Secret(this, 'AnthropicApiKey', {
      secretName: `${env}-claude-api-key`,
      description: 'Anthropic API Key for Claude Code',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ apiKey: 'PLACEHOLDER' }),
        generateStringKey: 'generatedKey',
      },
    });

    // Create secret for code-server password
    const passwordSecret = new secretsmanager.Secret(this, 'CodeServerPassword', {
      secretName: `${env}-code-server-password`,
      description: 'Password for code-server authentication',
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    // Build Docker image from local Dockerfile
    const image = new ecr_assets.DockerImageAsset(this, 'ClaudeImage', {
      directory: path.join(__dirname, '..'),
      file: 'Dockerfile',
    });

    // Create Fargate Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ClaudeTaskDef', {
      memoryLimitMiB: 4096,
      cpu: 2048,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });

    // Add EFS volume to task definition
    const volumeName = 'workspace-volume';
    taskDefinition.addVolume({
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Grant task permission to read the secrets
    apiKeySecret.grantRead(taskDefinition.taskRole);
    passwordSecret.grantRead(taskDefinition.taskRole);

    // Grant EFS permissions to task role
    fileSystem.grant(taskDefinition.taskRole,
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite',
      'elasticfilesystem:ClientRootAccess'
    );

    // Add container to task definition
    const container = taskDefinition.addContainer('ClaudeContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'claude-code',
        logGroup: logGroup,
      }),
      environment: {
        ENV: env,
        AWS_REGION: this.region,
      },
      secrets: {
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret, 'apiKey'),
        PASSWORD: ecs.Secret.fromSecretsManager(passwordSecret),
      },
    });

    // Mount EFS volume to container
    container.addMountPoints({
      sourceVolume: volumeName,
      containerPath: '/workspace',
      readOnly: false,
    });

    // Add port mapping for code-server web interface
    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    // Create Application Load Balanced Fargate Service
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      'ClaudeService',
      {
        cluster: cluster,
        taskDefinition: taskDefinition,
        publicLoadBalancer: true,
        desiredCount: 1,
        serviceName: `${env}-claude-service`,
        assignPublicIp: false,
        healthCheckGracePeriod: cdk.Duration.seconds(60),
      }
    );

    // Configure health check for code-server
    fargateService.targetGroup.configureHealthCheck({
      path: '/healthz',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Allow ECS tasks to access EFS
    fileSystem.connections.allowDefaultPortFrom(
      fargateService.service.connections,
      'Allow ECS tasks to access EFS'
    );

    // Configure auto-scaling for dev environments
    // Note: For production, consider fixed capacity per user instead
    const scaling = fargateService.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 5,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.minutes(10),
      scaleOutCooldown: cdk.Duration.minutes(5),
    });

    // Allow outbound HTTPS traffic for API calls
    fargateService.service.connections.allowToAnyIpv4(
      ec2.Port.tcp(443),
      'Allow HTTPS outbound for Claude API'
    );

    // Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'DNS name of the load balancer',
    });

    new cdk.CfnOutput(this, 'CodeServerURL', {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}`,
      description: 'URL to access code-server (VS Code in browser)',
    });

    new cdk.CfnOutput(this, 'ApiKeySecretArn', {
      value: apiKeySecret.secretArn,
      description: 'ARN of the Anthropic API Key secret',
    });

    new cdk.CfnOutput(this, 'PasswordSecretArn', {
      value: passwordSecret.secretArn,
      description: 'ARN of the code-server password secret',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'Name of the ECS cluster',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: fargateService.service.serviceName,
      description: 'Name of the ECS service',
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch Log Group name',
    });

    new cdk.CfnOutput(this, 'FileSystemId', {
      value: fileSystem.fileSystemId,
      description: 'EFS File System ID for workspace storage',
    });
  }
}
