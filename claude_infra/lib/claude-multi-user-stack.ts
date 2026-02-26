import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export class ClaudeMultiUserStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = this.node.tryGetContext('env') || 'dev';

    // Create VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'ClaudeVpc', {
      maxAzs: 2,
      natGateways: 2, // HA: NAT Gateway per AZ
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
      clusterName: `${env}-claude-multi-user-cluster`,
      containerInsights: true,
    });

    // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'ClaudeLogGroup', {
      logGroupName: `/ecs/${env}-claude-multi-user`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create shared EFS file system
    const fileSystem = new efs.FileSystem(this, 'ClaudeWorkspaceFS', {
      vpc: vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep user data
      fileSystemName: `${env}-claude-workspace-multi`,
    });

    // Security group for EFS
    fileSystem.connections.allowDefaultPortFrom(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      'Allow EFS access from VPC'
    );

    // Create secret for shared Anthropic API Key
    const sharedApiKeySecret = new secretsmanager.Secret(this, 'SharedAnthropicApiKey', {
      secretName: `${env}-claude-shared-api-key`,
      description: 'Shared Anthropic API Key for all users',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ apiKey: 'PLACEHOLDER' }),
        generateStringKey: 'generatedKey',
      },
    });

    // DynamoDB Table: Users
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `${env}-claude-users`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Add GSI for email lookup
    usersTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: {
        name: 'email',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // DynamoDB Table: Environments
    const environmentsTable = new dynamodb.Table(this, 'EnvironmentsTable', {
      tableName: `${env}-claude-environments`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'environmentId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Add GSI for status queries
    environmentsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'lastAccessedAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Build Docker image
    const image = new ecr_assets.DockerImageAsset(this, 'ClaudeImage', {
      directory: path.join(__dirname, '..'),
      file: 'Dockerfile',
    });

    // Create task definition (template for user containers)
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ClaudeTaskDef', {
      memoryLimitMiB: 4096,
      cpu: 2048,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });

    // Grant permissions
    sharedApiKeySecret.grantRead(taskDefinition.taskRole);
    fileSystem.grant(taskDefinition.taskRole,
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite',
      'elasticfilesystem:ClientRootAccess'
    );

    // Create Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ClaudeALB', {
      vpc,
      internetFacing: true,
      loadBalancerName: `${env}-claude-multi-user-alb`,
    });

    // HTTP Listener (will redirect to HTTPS in production)
    const httpListener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'No route found. Please access via your assigned subdomain.',
      }),
    });

    // IAM Role for Provisioning Lambda
    const provisioningLambdaRole = new iam.Role(this, 'ProvisioningLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Grant Lambda permissions
    usersTable.grantReadWriteData(provisioningLambdaRole);
    environmentsTable.grantReadWriteData(provisioningLambdaRole);

    provisioningLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecs:RunTask',
        'ecs:StopTask',
        'ecs:DescribeTasks',
        'ecs:ListTasks',
      ],
      resources: ['*'],
    }));

    provisioningLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticfilesystem:CreateAccessPoint',
        'elasticfilesystem:DeleteAccessPoint',
        'elasticfilesystem:DescribeAccessPoints',
      ],
      resources: [fileSystem.fileSystemArn],
    }));

    provisioningLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticloadbalancing:CreateTargetGroup',
        'elasticloadbalancing:DeleteTargetGroup',
        'elasticloadbalancing:CreateRule',
        'elasticloadbalancing:DeleteRule',
        'elasticloadbalancing:DescribeRules',
        'elasticloadbalancing:DescribeTargetGroups',
        'elasticloadbalancing:RegisterTargets',
        'elasticloadbalancing:DeregisterTargets',
        'elasticloadbalancing:ModifyRule',
      ],
      resources: ['*'],
    }));

    provisioningLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:DeleteSecret',
        'secretsmanager:GetSecretValue',
        'secretsmanager:PutSecretValue',
      ],
      resources: ['*'],
    }));

    provisioningLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [
        taskDefinition.taskRole.roleArn,
        taskDefinition.obtainExecutionRole().roleArn,
      ],
    }));

    // Provisioning Lambda Function
    const provisioningLambda = new lambda.Function(this, 'ProvisioningLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/provisioning')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: provisioningLambdaRole,
      environment: {
        USERS_TABLE: usersTable.tableName,
        ENVIRONMENTS_TABLE: environmentsTable.tableName,
        CLUSTER_ARN: cluster.clusterArn,
        TASK_DEFINITION: taskDefinition.taskDefinitionArn,
        VPC_ID: vpc.vpcId,
        PRIVATE_SUBNETS: vpc.privateSubnets.map(s => s.subnetId).join(','),
        SECURITY_GROUP_ID: '', // Will be set after creating
        ALB_LISTENER_ARN: httpListener.listenerArn,
        EFS_FILE_SYSTEM_ID: fileSystem.fileSystemId,
        SHARED_API_KEY_SECRET_ARN: sharedApiKeySecret.secretArn,
        LOG_GROUP_NAME: logGroup.logGroupName,
        ENV: env,
      },
    });

    // Cleanup Lambda Function (runs hourly)
    const cleanupLambda = new lambda.Function(this, 'CleanupLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/cleanup')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      role: provisioningLambdaRole,
      environment: {
        ENVIRONMENTS_TABLE: environmentsTable.tableName,
        AUTO_STOP_HOURS: '8',
      },
    });

    // Schedule cleanup Lambda to run every hour
    const cleanupRule = new events.Rule(this, 'CleanupRule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      description: 'Cleanup idle Claude Code environments',
    });
    cleanupRule.addTarget(new targets.LambdaFunction(cleanupLambda));

    // API Gateway for user portal
    const api = new apigateway.RestApi(this, 'ClaudePortalApi', {
      restApiName: `${env}-claude-portal`,
      description: 'API for Claude Code multi-user portal',
      deployOptions: {
        stageName: env,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // API Endpoints
    const environments = api.root.addResource('environments');

    // POST /environments - Create/Get user environment
    environments.addMethod(
      'POST',
      new apigateway.LambdaIntegration(provisioningLambda, {
        proxy: true,
      })
    );

    // GET /environments/{userId} - Get user environment status
    const userEnvironment = environments.addResource('{userId}');
    userEnvironment.addMethod(
      'GET',
      new apigateway.LambdaIntegration(provisioningLambda, {
        proxy: true,
      })
    );

    // DELETE /environments/{userId} - Stop user environment
    userEnvironment.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(provisioningLambda, {
        proxy: true,
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
      description: 'DNS name of the load balancer (set up wildcard DNS)',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint for user portal',
    });

    new cdk.CfnOutput(this, 'UsersTableName', {
      value: usersTable.tableName,
      description: 'DynamoDB Users table',
    });

    new cdk.CfnOutput(this, 'EnvironmentsTableName', {
      value: environmentsTable.tableName,
      description: 'DynamoDB Environments table',
    });

    new cdk.CfnOutput(this, 'FileSystemId', {
      value: fileSystem.fileSystemId,
      description: 'EFS File System ID',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS Cluster name',
    });

    new cdk.CfnOutput(this, 'TaskDefinitionArn', {
      value: taskDefinition.taskDefinitionArn,
      description: 'ECS Task Definition ARN',
    });

    new cdk.CfnOutput(this, 'SharedApiKeySecretArn', {
      value: sharedApiKeySecret.secretArn,
      description: 'Shared Anthropic API Key secret',
    });
  }
}
