import { 
  Duration, 
  Stack, 
  StackProps, 
  CfnOutput,
  SecretValue 
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class SupersetStack2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. VPC with 2 public subnets across AZs
    const vpc = new ec2.Vpc(this, 'SupersetVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ]
    });

    // Database credentials secret
    const dbSecret = new secretsmanager.Secret(this, 'SupersetDbSecret', {
      secretName: 'superset-db-credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
      },
    });

    // 2. RDS PostgreSQL Instance
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for RDS PostgreSQL database',
      allowAllOutbound: false,
    });

    const database = new rds.DatabaseInstance(this, 'SupersetDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromSecret(dbSecret),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      databaseName: 'superset',
      securityGroups: [dbSecurityGroup],
      deletionProtection: false,
      backupRetention: Duration.days(1),
    });

    // Superset secret key
    const supersetSecret = new secretsmanager.Secret(this, 'SupersetSecretKey', {
      secretName: 'superset-secret-key',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'secret_key',
        excludeCharacters: '"@/\\\'',
      },
    });

    // 3. ECS Cluster (Fargate)
    const cluster = new ecs.Cluster(this, 'SupersetCluster', {
      vpc,
      clusterName: 'superset-cluster',
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'SupersetTaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    // Grant permissions to read secrets
    dbSecret.grantRead(taskDefinition.taskRole);
    supersetSecret.grantRead(taskDefinition.taskRole);

    // Container Definition
    const container = taskDefinition.addContainer('SupersetContainer', {
      image: ecs.ContainerImage.fromRegistry('apache/superset:latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'superset',
        logGroup: new logs.LogGroup(this, 'SupersetLogGroup', {
          logGroupName: '/ecs/superset',
          retention: logs.RetentionDays.ONE_WEEK,
        }),
      }),
      environment: {
        SUPERSET_CONFIG_PATH: '/app/pythonpath/superset_config.py',
        DB_HOST: database.instanceEndpoint.hostname,
        DB_PORT: database.instanceEndpoint.port.toString(),
        DB_NAME: 'superset',
      },
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        SUPERSET_SECRET_KEY: ecs.Secret.fromSecretsManager(supersetSecret, 'secret_key'),
      },
      command: [
        '/bin/bash',
        '-c',
        `export SQLALCHEMY_DATABASE_URI="postgresql://\${DB_USER}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_NAME}" && \
         superset db upgrade && \
         superset fab create-admin --username admin --firstname Superset --lastname Admin --email admin@superset.com --password admin && \
         superset init && \
         superset run -h 0.0.0.0 -p 8088 --with-threads --reload --debugger`
      ],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8088/health || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(180),
      },
    });

    container.addPortMappings({
      containerPort: 8088,
      protocol: ecs.Protocol.TCP,
    });

    // Security Group for ECS Service
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Security group for ECS Superset service',
    });

    // Allow ECS to connect to RDS
    dbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS to connect to PostgreSQL'
    );

    // Fargate Service
    const service = new ecs.FargateService(this, 'SupersetService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // 4. Application Load Balancer (ALB)
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Security group for Application Load Balancer',
    });

    // Allow internet access to ALB
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from internet'
    );

    // Allow ALB to connect to ECS
    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(8088),
      'Allow ALB to connect to ECS service'
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, 'SupersetALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'SupersetTargetGroup', {
      vpc,
      port: 8088,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        path: '/health',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        protocol: elbv2.Protocol.HTTP,
      },
    });

    // Add ECS service to target group
    service.attachToApplicationTargetGroup(targetGroup);

    // Listener
    alb.addListener('SupersetListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // 6. Outputs
    new CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
      description: 'DNS name of the Load Balancer',
    });

    new CfnOutput(this, 'SupersetLoginURL', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'Superset login URL',
    });

    new CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
    });
  }
}
