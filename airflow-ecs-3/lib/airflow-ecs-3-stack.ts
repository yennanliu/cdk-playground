import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class AirflowEcs3Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'AirflowVpc', {
      maxAzs: 2,
      natGateways: 1, // Minimal setup - single NAT gateway
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

    // Allow ECS to connect to RDS
    dbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS tasks to connect to PostgreSQL'
    );

    // Create RDS PostgreSQL database
    const database = new rds.DatabaseInstance(this, 'AirflowDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      credentials: rds.Credentials.fromGeneratedSecret('airflow', {
        secretName: 'airflow-db-credentials',
        excludeCharacters: '/"@\\\'',
      }),
      databaseName: 'airflow',
      allocatedStorage: 20,
      securityGroups: [dbSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      backupRetention: Duration.days(0), // No backup for simplicity
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: this.node.tryGetContext('prod') ? undefined : 
        Stack.of(this).node.tryGetContext('destroy') ? 
        undefined : 
        Stack.of(this).stackName.includes('prod') ? undefined :
        this.node.tryGetContext('dev-destroy') ? 
        undefined : undefined, // Let CDK decide
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'AirflowCluster', {
      vpc,
      clusterName: 'airflow-cluster',
    });

    // Create ECS Task Role
    const taskRole = new iam.Role(this, 'AirflowTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Create log group with unique name
    const logGroup = new logs.LogGroup(this, 'AirflowLogGroup', {
      logGroupName: `/ecs/airflow-${this.stackName.toLowerCase()}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create ECS Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'AirflowTaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole: taskRole,
    });

    // Add container to task definition
    const container = taskDefinition.addContainer('AirflowContainer', {
      image: ecs.ContainerImage.fromRegistry('apache/airflow:2.8.1'),
      environment: {
        AIRFLOW__CORE__EXECUTOR: 'LocalExecutor',
        AIRFLOW__CORE__LOAD_EXAMPLES: 'False',
        AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION: 'True',
        AIRFLOW__WEBSERVER__EXPOSE_CONFIG: 'True',
        AIRFLOW__CORE__FERNET_KEY: 'YlCImzjge_TeZc4LMXaHW-HCKtdXsq_Y6TGFdSvgB7Y=', // Demo key - change in production
        _AIRFLOW_WWW_USER_USERNAME: 'admin',
        _AIRFLOW_WWW_USER_PASSWORD: 'admin123',
        POSTGRES_HOST: database.instanceEndpoint.hostname,
        POSTGRES_PORT: database.instanceEndpoint.port.toString(),
        POSTGRES_DB: 'airflow',
      },
      secrets: {
        POSTGRES_USER: ecs.Secret.fromSecretsManager(database.secret!, 'username'),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'airflow',
        logGroup: logGroup,
      }),
      command: [
        'bash', '-c',
        `
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
        
        # Wait a bit for database to be fully ready
        echo "Waiting for database to be ready..."
        sleep 30
        
        # Initialize/migrate the database with retries
        retry_db_operation "airflow db migrate"
        
        # Create default connections (optional, continue if fails)
        echo "Creating default connections..."
        airflow connections create-default-connections || echo "Default connections creation skipped"
        
        # Create admin user with retries
        echo "Creating admin user..."
        retry_db_operation "airflow users create --username admin --firstname Admin --lastname User --role Admin --email admin@example.com --password admin123"
        
        echo "Database initialization completed successfully!"
        echo "Starting Airflow services..."
        
        # Start webserver in background
        airflow webserver --port 8080 &
        webserver_pid=\$!
        echo "Webserver started with PID \$webserver_pid"
        
        # Give webserver time to start
        sleep 15
        
        # Start scheduler in foreground (this keeps container running)
        echo "Starting scheduler..."
        exec airflow scheduler
        `
      ],
    });

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
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
      'Allow ALB to connect to Airflow'
    );

    // Allow HTTP traffic to ALB
    alb.connections.allowFromAnyIpv4(ec2.Port.tcp(80));

    // Create ECS Service
    const service = new ecs.FargateService(this, 'AirflowService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ecsSecurityGroup],
    });

    // Create target group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'AirflowTargetGroup', {
      port: 8080,
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Add ECS service to target group
    service.attachToApplicationTargetGroup(targetGroup);

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

    new CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS Database Endpoint',
    });

    new CfnOutput(this, 'DefaultCredentials', {
      value: 'Username: admin, Password: admin123',
      description: 'Default Airflow credentials',
    });
  }
}
