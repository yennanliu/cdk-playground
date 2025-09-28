import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class EcsFeBeApp1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC with public subnets
    const vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs: 2,
      natGateways: 0, // Using public subnets only as requested
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        }
      ],
    });

    // Security Groups
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'ECSSecurityGroup', {
      vpc,
      description: 'Security group for ECS tasks',
      allowAllOutbound: true,
    });
    ecsSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.allTraffic(), 'Allow from ALB');

    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RDSSecurityGroup', {
      vpc,
      description: 'Security group for RDS MySQL',
      allowAllOutbound: false,
    });
    rdsSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(3306), 'Allow MySQL from ECS');


    // RDS MySQL Database
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_35,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      securityGroups: [rdsSecurityGroup],
      databaseName: 'shoppingcart',
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'shopping-cart-cluster',
    });

    // CloudWatch Log Groups
    const backendLogGroup = new logs.LogGroup(this, 'BackendLogGroup', {
      logGroupName: '/ecs/shopping-cart-backend',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const frontendLogGroup = new logs.LogGroup(this, 'FrontendLogGroup', {
      logGroupName: '/ecs/shopping-cart-frontend',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Backend Task Definition
    const backendTaskDefinition = new ecs.FargateTaskDefinition(this, 'BackendTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    backendTaskDefinition.addContainer('backend-container', {
      image: ecs.ContainerImage.fromRegistry('yennanliu/shopping-cart-backend:latest'),
      portMappings: [
        {
          containerPort: 8080,
          protocol: ecs.Protocol.TCP,
        },
      ],
      environment: {
        SPRING_PROFILES_ACTIVE: 'prod',
        SERVER_PORT: '8080',
      },
      secrets: {
        SPRING_DATASOURCE_URL: ecs.Secret.fromSecretsManager(database.secret!, 'endpoint'),
        SPRING_DATASOURCE_USERNAME: ecs.Secret.fromSecretsManager(database.secret!, 'username'),
        SPRING_DATASOURCE_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'backend',
        logGroup: backendLogGroup,
      }),
    });

    // Frontend Task Definition
    const frontendTaskDefinition = new ecs.FargateTaskDefinition(this, 'FrontendTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    frontendTaskDefinition.addContainer('frontend-container', {
      image: ecs.ContainerImage.fromRegistry('yennanliu/shopping-cart-frontend:latest'),
      portMappings: [
        {
          containerPort: 80,
          protocol: ecs.Protocol.TCP,
        },
      ],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'frontend',
        logGroup: frontendLogGroup,
      }),
    });

    // Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    const listener = alb.addListener('Listener', {
      port: 80,
      open: true,
    });

    // Backend Service
    const backendService = new ecs.FargateService(this, 'BackendService', {
      cluster,
      taskDefinition: backendTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [ecsSecurityGroup],
    });

    const backendTargetGroup = new elbv2.ApplicationTargetGroup(this, 'BackendTargetGroup', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        path: '/actuator/health',
        healthyHttpCodes: '200',
      },
    });

    backendTargetGroup.addTarget(backendService);

    // Frontend Service
    const frontendService = new ecs.FargateService(this, 'FrontendService', {
      cluster,
      taskDefinition: frontendTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [ecsSecurityGroup],
    });

    const frontendTargetGroup = new elbv2.ApplicationTargetGroup(this, 'FrontendTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        path: '/',
        healthyHttpCodes: '200',
      },
    });

    frontendTargetGroup.addTarget(frontendService);

    // ALB Listener Rules - Path-based routing
    listener.addAction('backend-rule', {
      priority: 100,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*'])],
      action: elbv2.ListenerAction.forward([backendTargetGroup]),
    });

    listener.addAction('frontend-rule', {
      priority: 200,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
      action: elbv2.ListenerAction.forward([frontendTargetGroup]),
    });

    // Outputs
    new CfnOutput(this, 'ALBDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
    });


    new CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS MySQL database endpoint',
    });

    new CfnOutput(this, 'DatabaseSecretArn', {
      value: database.secret?.secretArn || 'N/A',
      description: 'Database credentials secret ARN',
    });
  }
}
