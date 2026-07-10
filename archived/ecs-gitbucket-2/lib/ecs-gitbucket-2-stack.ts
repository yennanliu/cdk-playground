import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";

export class EcsGitbucket2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC with public and private subnets
    const vpc = new ec2.Vpc(this, "GitBucketVpc", {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: "Database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "GitBucketCluster", {
      vpc,
    });

    // Security Groups
    const efsSecurityGroup = new ec2.SecurityGroup(this, "EfsSecurityGroup", {
      vpc,
      description: "Security group for EFS",
      allowAllOutbound: false,
    });

    const rdsSecurityGroup = new ec2.SecurityGroup(this, "RdsSecurityGroup", {
      vpc,
      description: "Security group for RDS",
      allowAllOutbound: false,
    });

    const ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc,
      description: "Security group for ECS tasks",
      allowAllOutbound: true,
    });

    // Allow ECS to access EFS
    efsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(2049),
      "Allow ECS to access EFS"
    );

    // Explicitly allow ECS outbound to EFS
    ecsSecurityGroup.addEgressRule(
      efsSecurityGroup,
      ec2.Port.tcp(2049),
      "Allow ECS outbound to EFS"
    );

    // Allow ECS to access RDS
    rdsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow ECS to access PostgreSQL"
    );

    // EFS File System for persistent storage
    const fileSystem = new efs.FileSystem(this, "GitBucketFileSystem", {
      vpc,
      securityGroup: efsSecurityGroup,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
    });

    // EFS Access Point
    const accessPoint = new efs.AccessPoint(this, "GitBucketAccessPoint", {
      fileSystem,
      path: "/gitbucket",
      posixUser: {
        uid: "1000",
        gid: "1000",
      },
      createAcl: {
        ownerGid: "1000",
        ownerUid: "1000",
        permissions: "755",
      },
    });

    // Database credentials secret
    const dbSecret = new secretsmanager.Secret(this, "GitBucketDbSecret", {
      secretName: "GitBucketDatabaseCredentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "gitbucket" }),
        generateStringKey: "password",
        excludeCharacters: '"@/\\',
        passwordLength: 32,
      },
    });

    // RDS PostgreSQL Database
    const database = new rds.DatabaseInstance(this, "GitBucketDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14_17,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [rdsSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: "gitbucket",
      allocatedStorage: 20,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false, // Set to true for production
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change for production
    });

    // Log group
    const logGroup = new logs.LogGroup(this, "GitBucketLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, "GitBucketTaskDef", {
      memoryLimitMiB: 4096,
      cpu: 2048,
    });

    // Add EFS volume to task definition
    taskDefinition.addVolume({
      name: "gitbucket-data",
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: "ENABLED",
        },
        transitEncryption: "ENABLED",
        rootDirectory: "/",
      },
    });

    // Grant EFS permissions to task role
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
        ],
        resources: [fileSystem.fileSystemArn, accessPoint.accessPointArn],
      })
    );

    // Grant EFS permissions to execution role as well
    taskDefinition.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
          "elasticfilesystem:DescribeFileSystems",
          "elasticfilesystem:DescribeAccessPoints",
        ],
        resources: [fileSystem.fileSystemArn, accessPoint.accessPointArn],
      })
    );

    // Grant access to database secret
    dbSecret.grantRead(taskDefinition.taskRole);

    // Container definition
    const container = taskDefinition.addContainer("GitBucketContainer", {
      image: ecs.ContainerImage.fromRegistry("gitbucket/gitbucket"),
      environment: {
        GITBUCKET_HOME: "/gitbucket",
        // GitBucket database configuration via environment variables
        GITBUCKET_DB_URL: `jdbc:postgresql://${database.instanceEndpoint.hostname}:${database.instanceEndpoint.port}/gitbucket`,
        // Git-specific optimizations for large pushes
        GIT_HTTP_MAX_REQUEST_BUFFER: "100M",
        GITBUCKET_MAX_FILE_SIZE: "100M",
      },
      secrets: {
        GITBUCKET_DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
        GITBUCKET_DB_USER: ecs.Secret.fromSecretsManager(dbSecret, "username"),
      },
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "GitBucket",
      }),
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:8080/ || exit 1"],
        interval: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(30),
        retries: 5,
        startPeriod: cdk.Duration.seconds(120),
      },
    });

    // Add mount point for EFS
    container.addMountPoints({
      sourceVolume: "gitbucket-data",
      containerPath: "/gitbucket",
      readOnly: false,
    });

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    // Fargate service with ALB
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "GitBucketService",
      {
        cluster,
        taskDefinition,
        desiredCount: 1,
        publicLoadBalancer: true,
        securityGroups: [ecsSecurityGroup],
        taskSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        // Configure load balancer for large git operations
        listenerPort: 80,
      }
    );

    // Configure target group for better handling of git operations
    fargateService.targetGroup.configureHealthCheck({
      path: "/",
      healthyHttpCodes: "200,302",
      interval: cdk.Duration.seconds(60),
      timeout: cdk.Duration.seconds(10),
      healthyThresholdCount: 3,
      unhealthyThresholdCount: 10,
    });

    // Increase deregistration delay for graceful shutdown during git operations
    fargateService.targetGroup.setAttribute(
      "deregistration_delay.timeout_seconds",
      "600"
    );

    // Configure load balancer for large uploads (git push)
    fargateService.loadBalancer.setAttribute(
      "idle_timeout.timeout_seconds",
      "900"
    );

    // Allow EFS access from ECS service
    fileSystem.connections.allowDefaultPortFrom(fargateService.service);

    // Allow RDS access from ECS service
    database.connections.allowDefaultPortFrom(fargateService.service);

    // Outputs
    new cdk.CfnOutput(this, "GitBucketURL", {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}`,
      description: "GitBucket Load Balancer URL",
    });

    new cdk.CfnOutput(this, "GitCloneURLFormat", {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}/git/{username}/{repository}.git`,
      description: "Git clone URL format - replace {username} and {repository} with actual values",
    });

    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: database.instanceEndpoint.hostname,
      description: "RDS Database Endpoint",
    });

    new cdk.CfnOutput(this, "EFSFileSystemId", {
      value: fileSystem.fileSystemId,
      description: "EFS File System ID",
    });

    new cdk.CfnOutput(this, "DatabaseConfigInstructions", {
      value: "GitBucket will auto-configure database on first startup using environment variables",
      description: "Database Configuration",
    });
  }
}
