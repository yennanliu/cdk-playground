import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Construct } from 'constructs';

export class AirflowEcs3Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Determine if this is a production environment
    const isProd = this.node.tryGetContext('prod') === true || 
                   this.stackName.toLowerCase().includes('prod');

    // Create a unique suffix for this deployment to avoid conflicts
    const uniqueSuffix = this.node.addr.substring(0, 8);

    // Create VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'AirflowVpc', {
      maxAzs: 2,
      natGateways: 1, // Minimal setup - single NAT gateway
      enableDnsHostnames: true,
      enableDnsSupport: true,
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

    // Create S3 bucket for DAG storage
    const dagsBucket = new s3.Bucket(this, 'AirflowDagsBucket', {
      //bucketName: `airflow-dags-${this.account}-${this.region}-${this.stackName.toLowerCase()}-${uniqueSuffix}`,
      bucketName: `airflow-dags-${this.stackName.toLowerCase()}-${uniqueSuffix}`,
    
      versioned: true,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // Create security group for EFS
    const efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
      vpc,
      description: 'Security group for Airflow EFS',
      allowAllOutbound: false,
    });

    // Create EFS file system for shared DAG storage
    const fileSystem = new efs.FileSystem(this, 'AirflowEfs', {
      vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      securityGroup: efsSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Create security group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for Airflow RDS database',
      allowAllOutbound: false,
    });

    // Create security group for ECS
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,  
      description: 'Security group for Airflow ECS tasks',
      allowAllOutbound: true,
    });

    // Allow ECS to connect to RDS (PostgreSQL)
    dbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS tasks to connect to PostgreSQL'
    );

    // Allow ECS to access EFS
    efsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow ECS tasks to access EFS'
    );

    // Allow ECS to connect to EFS (bidirectional)
    ecsSecurityGroup.addEgressRule(
      efsSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow ECS tasks to connect to EFS'
    );

    // Create EFS access point
    const accessPoint = new efs.AccessPoint(this, 'AirflowEfsAccessPoint', {
      fileSystem,
      path: '/airflow/dags',
      createAcl: {
        ownerUid: '50000',
        ownerGid: '0',
        permissions: '0755',
      },
      posixUser: {
        uid: '50000',
        gid: '0',
      },
    });

    // Create RDS PostgreSQL database
    const database = new rds.DatabaseInstance(this, 'AirflowDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      credentials: rds.Credentials.fromGeneratedSecret('airflow', {
        secretName: `airflow-db-credentials-${this.stackName.toLowerCase()}-${uniqueSuffix}`,
        excludeCharacters: '/"@\\\'',
      }),
      databaseName: 'airflow',
      allocatedStorage: 20,
      securityGroups: [dbSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      backupRetention: isProd ? Duration.days(7) : Duration.days(0),
      deleteAutomatedBackups: !isProd,
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'AirflowCluster', {
      vpc,
      clusterName: 'airflow-cluster',
    });

    // Create ECS Task Role with S3 and EFS permissions
    const taskRole = new iam.Role(this, 'AirflowTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Add S3 permissions to task role
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
        's3:PutObject',
        's3:DeleteObject',
      ],
      resources: [
        dagsBucket.bucketArn,
        `${dagsBucket.bucketArn}/*`,
      ],
    }));

    // Add EFS permissions to task role
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite',
        'elasticfilesystem:ClientRootAccess',
        'elasticfilesystem:DescribeMountTargets',
        'elasticfilesystem:DescribeFileSystems',
        'elasticfilesystem:DescribeAccessPoints',
        'elasticfilesystem:ClientAttach',
      ],
      resources: [
        fileSystem.fileSystemArn,
        accessPoint.accessPointArn,
      ],
    }));

    // Create ECS Task Execution Role with additional permissions
    const taskExecutionRole = new iam.Role(this, 'AirflowTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Create log group with unique name
    const logGroup = new logs.LogGroup(this, 'AirflowLogGroup', {
      logGroupName: `/ecs/airflow-${this.stackName.toLowerCase()}-${uniqueSuffix}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Common environment variables
    const commonEnvironment = {
      AIRFLOW__CORE__EXECUTOR: 'LocalExecutor',
      AIRFLOW__CORE__LOAD_EXAMPLES: 'False',
      AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION: 'True',
      AIRFLOW__WEBSERVER__EXPOSE_CONFIG: 'True',
      AIRFLOW__CORE__FERNET_KEY: 'YlCImzjge_TeZc4LMXaHW-HCKtdXsq_Y6TGFdSvgB7Y=', // Demo key - change in production
      POSTGRES_HOST: database.instanceEndpoint.hostname,
      POSTGRES_PORT: database.instanceEndpoint.port.toString(),
      POSTGRES_DB: 'airflow',
      AIRFLOW_DAGS_BUCKET: dagsBucket.bucketName,
    };

    // Common secrets
    const commonSecrets = {
      POSTGRES_USER: ecs.Secret.fromSecretsManager(database.secret!, 'username'),
      POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
    };

    // Common DAG sync script
    const dagSyncScript = `
      echo "Checking EFS mount..."
      if ! mountpoint -q /opt/airflow/dags; then
        echo "EFS not mounted at /opt/airflow/dags, waiting..."
        sleep 10
      fi
      
      echo "Creating DAGs directory if not exists..."
      mkdir -p /opt/airflow/dags
      chown -R 50000:0 /opt/airflow/dags
      
      echo "Syncing DAGs from S3..."
      aws s3 sync s3://$AIRFLOW_DAGS_BUCKET/dags /opt/airflow/dags --delete
      echo "DAG sync completed"
    `;

    // Database initialization script
    const dbInitScript = `
      set -e
      echo "Starting Airflow initialization..."
      
      # Set the database connection string
      export AIRFLOW__DATABASE__SQL_ALCHEMY_CONN="postgresql+psycopg2://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@\${POSTGRES_HOST}:\${POSTGRES_PORT}/\${POSTGRES_DB}"
      echo "Database connection configured"
      
      # Function to retry database operations
      retry_db_operation() {
        local max_attempts=10
        local attempt=0
        local operation="\$1"
        
        until [ \$attempt -ge \$max_attempts ]; do
          attempt=\$((attempt + 1))
          echo "Attempting \$operation (attempt \$attempt/\$max_attempts)..."
          
          if eval "\$operation"; then
            echo "\$operation completed successfully"
            return 0
          else
            echo "\$operation failed, waiting 15 seconds before retry..."
            sleep 15
          fi
        done
        
        echo "\$operation failed after \$max_attempts attempts"
        return 1
      }
      
      # Wait for database to be ready
      echo "Waiting for database to be ready..."
      sleep 30
      
      # Initialize/migrate the database with retries
      retry_db_operation "airflow db migrate"
      
      # Create default connections (optional)
      echo "Creating default connections..."
      airflow connections create-default-connections || echo "Default connections creation skipped"
      
      # Create admin user with retries
      echo "Creating admin user..."
      retry_db_operation "airflow users create --username admin --firstname Admin --lastname User --role Admin --email admin@example.com --password admin123" || echo "User already exists"
      
      echo "Database initialization completed successfully!"
    `;

    // Create Webserver Task Definition
    const webserverTaskDefinition = new ecs.FargateTaskDefinition(this, 'AirflowWebserverTaskDefinition', {
      memoryLimitMiB: 1024,
      cpu: 512,
      taskRole: taskRole,
      executionRole: taskExecutionRole,
    });

    // Add EFS volume to webserver task
    webserverTaskDefinition.addVolume({
      name: 'airflow-dags',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Add webserver container
    const webserverContainer = webserverTaskDefinition.addContainer('AirflowWebserverContainer', {
      image: ecs.ContainerImage.fromRegistry('apache/airflow:2.8.1'),
      environment: {
        ...commonEnvironment,
        _AIRFLOW_WWW_USER_USERNAME: 'admin',
        _AIRFLOW_WWW_USER_PASSWORD: 'admin123',
      },
      secrets: commonSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'airflow-webserver',
        logGroup: logGroup,
      }),
      command: [
        'bash', '-c',
        `
        ${dbInitScript}
        ${dagSyncScript}
        echo "Starting Airflow webserver..."
        exec airflow webserver --port 8080
        `
      ],
    });

    webserverContainer.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    webserverContainer.addMountPoints({
      sourceVolume: 'airflow-dags',
      containerPath: '/opt/airflow/dags',
      readOnly: false,
    });

    // Create Scheduler Task Definition
    const schedulerTaskDefinition = new ecs.FargateTaskDefinition(this, 'AirflowSchedulerTaskDefinition', {
      memoryLimitMiB: 1024,
      cpu: 512,
      taskRole: taskRole,
      executionRole: taskExecutionRole,
    });

    // Add EFS volume to scheduler task
    schedulerTaskDefinition.addVolume({
      name: 'airflow-dags',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Add scheduler container
    const schedulerContainer = schedulerTaskDefinition.addContainer('AirflowSchedulerContainer', {
      image: ecs.ContainerImage.fromRegistry('apache/airflow:2.8.1'),
      environment: commonEnvironment,
      secrets: commonSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'airflow-scheduler',
        logGroup: logGroup,
      }),
      command: [
        'bash', '-c', 
        `
        # Set the database connection string
        export AIRFLOW__DATABASE__SQL_ALCHEMY_CONN="postgresql+psycopg2://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@\${POSTGRES_HOST}:\${POSTGRES_PORT}/\${POSTGRES_DB}"
        
        # Wait for database initialization (webserver should handle this)
        echo "Waiting for database initialization..."
        sleep 60
        
        ${dagSyncScript}
        echo "Starting Airflow scheduler..."
        exec airflow scheduler
        `
      ],
    });

    schedulerContainer.addMountPoints({
      sourceVolume: 'airflow-dags',
      containerPath: '/opt/airflow/dags',
      readOnly: false,
    });

    // Create ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'AirflowALB', {
      vpc,
      internetFacing: true,
      securityGroup: new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
        vpc,
        description: 'Security group for Airflow ALB',
        allowAllOutbound: true,
      }),
    });

    // Allow ALB to communicate with ECS
    alb.connections.allowTo(ecsSecurityGroup, ec2.Port.tcp(8080));
    ecsSecurityGroup.addIngressRule(
      alb.connections.securityGroups[0],
      ec2.Port.tcp(8080),
      'Allow ALB to connect to Airflow webserver'
    );

    // Allow HTTP traffic to ALB
    alb.connections.allowFromAnyIpv4(ec2.Port.tcp(80));

    // Create Webserver ECS Service
    const webserverService = new ecs.FargateService(this, 'AirflowWebserverService', {
      cluster,
      taskDefinition: webserverTaskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ecsSecurityGroup],
      serviceName: 'airflow-webserver',
    });

    // Create Scheduler ECS Service
    const schedulerService = new ecs.FargateService(this, 'AirflowSchedulerService', {
      cluster,
      taskDefinition: schedulerTaskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ecsSecurityGroup],
      serviceName: 'airflow-scheduler',
    });

    // Create target group with improved health check
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'AirflowTargetGroup', {
      port: 8080,
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Add webserver service to target group
    webserverService.attachToApplicationTargetGroup(targetGroup);

    // Create ALB listener
    const listener = alb.addListener('AirflowListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });

    // Outputs
    new CfnOutput(this, 'AirflowURL', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'Airflow Web UI URL',
    });

    new CfnOutput(this, 'DagsBucketName', {
      value: dagsBucket.bucketName,
      description: 'S3 bucket name for Airflow DAGs',
    });

    new CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS Database Endpoint',
    });

    new CfnOutput(this, 'DefaultCredentials', {
      value: 'Username: admin, Password: admin123',
      description: 'Default Airflow credentials',
    });

    new CfnOutput(this, 'EfsFileSystemId', {
      value: fileSystem.fileSystemId,
      description: 'EFS File System ID for shared DAG storage',
    });
  }
}
