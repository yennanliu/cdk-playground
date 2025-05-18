import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Construct } from 'constructs';
import { AirflowContainers } from './airflow-containers';
import { AirflowInit } from './airflow-init';

export class AirflowEcs1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'AirflowVPC', {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create a security group for Airflow
    const airflowSecurityGroup = new ec2.SecurityGroup(this, 'AirflowSecurityGroup', {
      vpc,
      description: 'Security group for Airflow ECS service',
      allowAllOutbound: true,
    });

    // Allow inbound on port 8080 for Airflow UI
    airflowSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8080),
      'Allow Airflow UI access'
    );

    // Create security group for PostgreSQL
    const postgresSecurityGroup = new ec2.SecurityGroup(this, 'PostgresSecurityGroup', {
      vpc,
      description: 'Security group for PostgreSQL',
      allowAllOutbound: true,
    });

    // Allow inbound from Airflow security group on PostgreSQL port
    postgresSecurityGroup.addIngressRule(
      airflowSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from Airflow'
    );

    // Create security group for Redis
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security group for Redis',
      allowAllOutbound: true,
    });

    // Allow inbound from Airflow security group on Redis port
    redisSecurityGroup.addIngressRule(
      airflowSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Redis access from Airflow'
    );

    // Create security group for EFS
    const efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
      vpc,
      description: 'Security group for EFS',
      allowAllOutbound: true,
    });

    // Allow inbound from Airflow security group on NFS port
    efsSecurityGroup.addIngressRule(
      airflowSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow NFS access from Airflow'
    );

    // Create an EFS File System for DAGs and plugins
    const fileSystem = new efs.FileSystem(this, 'AirflowEfsFileSystem', {
      vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      securityGroup: efsSecurityGroup,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create an EFS Access Point for DAGs
    const dagsAccessPoint = fileSystem.addAccessPoint('DagsAccessPoint', {
      path: '/dags',
      createAcl: {
        ownerGid: '50000',
        ownerUid: '50000',
        permissions: '755',
      },
      posixUser: {
        gid: '50000',
        uid: '50000',
      },
    });

    // Create database credentials in Secrets Manager
    const dbSecret = new secretsmanager.Secret(this, 'AirflowDBSecret', {
      secretName: 'airflow/db-credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });

    // Create PostgreSQL database for Airflow
    const postgresDb = new rds.DatabaseInstance(this, 'AirflowPostgresDB', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_13,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [postgresSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'airflow',
      allocatedStorage: 20,
      backupRetention: Duration.days(7),
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // Create Redis for Airflow's Celery Executor
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }).subnetIds,
    });

    const redis = new elasticache.CfnCacheCluster(this, 'AirflowRedis', {
      cacheNodeType: 'cache.t3.small',
      engine: 'redis',
      numCacheNodes: 1,
      autoMinorVersionUpgrade: true,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'AirflowCluster', {
      vpc,
    });

    // Create IAM role for ECS tasks
    const executionRole = new iam.Role(this, 'AirflowTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Create task role for Airflow
    const taskRole = new iam.Role(this, 'AirflowTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Add necessary permissions to the task role for EFS
    fileSystem.grantRootAccess(taskRole);

    // Create log groups for Airflow components
    const webserverLogGroup = new logs.LogGroup(this, 'WebserverLogGroup', {
      logGroupName: '/ecs/airflow-webserver',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const schedulerLogGroup = new logs.LogGroup(this, 'SchedulerLogGroup', {
      logGroupName: '/ecs/airflow-scheduler',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const workerLogGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
      logGroupName: '/ecs/airflow-worker',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const triggerLogGroup = new logs.LogGroup(this, 'TriggerLogGroup', {
      logGroupName: '/ecs/airflow-triggerer',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create log group for Airflow init
    const initLogGroup = new logs.LogGroup(this, 'InitLogGroup', {
      logGroupName: '/ecs/airflow-init',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Task Definition for Airflow Initialization
    const initTaskDefinition = new ecs.FargateTaskDefinition(this, 'AirflowInitTaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole,
    });

    // Grant access to the database secret
    dbSecret.grantRead(initTaskDefinition.executionRole!);

    // Create Airflow initialization task
    const airflowInit = new AirflowInit({
      scope: this,
      cluster,
      taskDefinition: initTaskDefinition,
      dbEndpointAddress: postgresDb.dbInstanceEndpointAddress,
      dbEndpointPort: postgresDb.dbInstanceEndpointPort,
      securityGroups: [airflowSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      logGroup: initLogGroup,
    });

    // Create a Task Definition for Airflow
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'AirflowTaskDefinition', {
      memoryLimitMiB: 4096,
      cpu: 2048,
      executionRole,
      taskRole,
    });

    // Add EFS volume to the task definition
    taskDefinition.addVolume({
      name: 'efs-dags',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: dagsAccessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Grant access to the database secret
    dbSecret.grantRead(taskDefinition.executionRole!);

    // Create Airflow containers
    const airflowContainers = new AirflowContainers({
      taskDefinition,
      dbEndpointAddress: postgresDb.dbInstanceEndpointAddress,
      dbEndpointPort: postgresDb.dbInstanceEndpointPort,
      redisEndpointAddress: redis.attrRedisEndpointAddress,
      redisEndpointPort: redis.attrRedisEndpointPort,
      webserverLogGroup,
      schedulerLogGroup,
      workerLogGroup,
      triggerLogGroup,
    });

    // Add EFS mount points to all containers
    airflowContainers.webserver.addMountPoints({
      containerPath: '/opt/airflow/dags',
      sourceVolume: 'efs-dags',
      readOnly: false,
    });
    
    airflowContainers.scheduler.addMountPoints({
      containerPath: '/opt/airflow/dags',
      sourceVolume: 'efs-dags',
      readOnly: false,
    });
    
    airflowContainers.worker.addMountPoints({
      containerPath: '/opt/airflow/dags',
      sourceVolume: 'efs-dags',
      readOnly: false,
    });
    
    airflowContainers.triggerer.addMountPoints({
      containerPath: '/opt/airflow/dags',
      sourceVolume: 'efs-dags',
      readOnly: false,
    });

    // Create a Fargate service for Airflow
    const airflowService = new ecs.FargateService(this, 'AirflowService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [airflowSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      assignPublicIp: false,
    });
    
    // Make the Airflow service depend on the init task
    airflowService.node.addDependency(airflowInit.initTask);

    // Add an Application Load Balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'AirflowALB', {
      vpc,
      internetFacing: true,
    });

    // Add a listener to the ALB
    const listener = lb.addListener('AirflowListener', {
      port: 80,
      open: true,
    });

    // Add target to the listener
    listener.addTargets('AirflowTarget', {
      port: 8080,
      targets: [airflowService],
      healthCheck: {
        path: '/health',
        port: '8080',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
      },
    });
    
    // Output the Load Balancer DNS name
    new CfnOutput(this, 'AirflowUIUrl', {
      value: `http://${lb.loadBalancerDnsName}`,
      description: 'URL for Airflow UI',
      exportName: 'AirflowUIUrl',
    });
    
    // Output Airflow credentials
    new CfnOutput(this, 'AirflowCredentials', {
      value: 'Username: airflow, Password: airflow',
      description: 'Default Airflow UI credentials',
      exportName: 'AirflowCredentials',
    });
    
    // Output database details for reference
    new CfnOutput(this, 'AirflowDBEndpoint', {
      value: postgresDb.dbInstanceEndpointAddress,
      description: 'Endpoint of the Airflow PostgreSQL database',
      exportName: 'AirflowDBEndpoint',
    });
    
    // Output Redis details for reference
    new CfnOutput(this, 'AirflowRedisEndpoint', {
      value: redis.attrRedisEndpointAddress,
      description: 'Endpoint of the Airflow Redis instance',
      exportName: 'AirflowRedisEndpoint',
    });
  }
}
