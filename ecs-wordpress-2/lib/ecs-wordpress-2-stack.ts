import { Duration, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';

export class EcsWordpress2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'WordPressVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ]
    });

    // Create database secret
    const dbSecret = new secretsmanager.Secret(this, 'DBSecret', {
      description: 'RDS MySQL credentials for WordPress',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'wordpress' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // Security Groups
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic'
    );

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic'
    );

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'ECSSecurityGroup', {
      vpc,
      description: 'Security group for ECS tasks',
      allowAllOutbound: true,
    });

    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(80),
      'Allow traffic from ALB'
    );

    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RDSSecurityGroup', {
      vpc,
      description: 'Security group for RDS database',
      allowAllOutbound: false,
    });

    rdsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(3306),
      'Allow MySQL traffic from ECS'
    );

    const efsSecurityGroup = new ec2.SecurityGroup(this, 'EFSSecurityGroup', {
      vpc,
      description: 'Security group for EFS',
      allowAllOutbound: false,
    });

    efsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow NFS traffic from ECS'
    );

    // Create RDS MySQL database
    const database = new rds.DatabaseInstance(this, 'WordPressDB', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'wordpress',
      securityGroups: [rdsSecurityGroup],
      backupRetention: Duration.days(7),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create EFS file system for WordPress files
    const fileSystem = new efs.FileSystem(this, 'WordPressEFS', {
      vpc,
      securityGroup: efsSecurityGroup,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'WordPressCluster', {
      vpc,
      containerInsights: true,
    });

    // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'WordPressLogGroup', {
      logGroupName: '/ecs/wordpress',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create ECS Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WordPressTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    // Add EFS volume to task definition
    taskDefinition.addVolume({
      name: 'wordpress-efs',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
      },
    });

    // Grant task role access to RDS secret
    dbSecret.grantRead(taskDefinition.taskRole);

    // Add WordPress container
    const wordpressContainer = taskDefinition.addContainer('wordpress', {
      image: ecs.ContainerImage.fromRegistry('wordpress:latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'wordpress',
        logGroup: logGroup,
      }),
      environment: {
        WORDPRESS_DB_HOST: database.instanceEndpoint.hostname,
        WORDPRESS_DB_NAME: 'wordpress',
      },
      secrets: {
        WORDPRESS_DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        WORDPRESS_DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost/ || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    });

    wordpressContainer.addPortMappings({
      containerPort: 80,
      protocol: ecs.Protocol.TCP,
    });

    // Mount EFS volume
    wordpressContainer.addMountPoints({
      sourceVolume: 'wordpress-efs',
      containerPath: '/var/www/html',
      readOnly: false,
    });

    // Create Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'WordPressALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    // Create Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'WordPressTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        healthyHttpCodes: '200,301,302',
        path: '/',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
    });

    // Add listener to ALB
    alb.addListener('WordPressListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });

    // Create ECS Service
    const service = new ecs.FargateService(this, 'WordPressService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ecsSecurityGroup],
      healthCheckGracePeriod: Duration.seconds(300),
    });

    // Attach service to target group
    service.attachToApplicationTargetGroup(targetGroup);

    // Enable auto scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 10,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(2),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(2),
    });

    // Output important information
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
      description: 'WordPress Application URL',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS Database Endpoint',
    });

    new cdk.CfnOutput(this, 'EFSFileSystemId', {
      value: fileSystem.fileSystemId,
      description: 'EFS File System ID',
    });
  }
}
