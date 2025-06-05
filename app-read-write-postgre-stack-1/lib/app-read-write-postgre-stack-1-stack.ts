import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export class AppReadWritePostgreStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create VPC
    const vpc = new ec2.Vpc(this, 'ApiVPC', {
      maxAzs: 2,
      natGateways: 1
    });

    // Create security groups
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: true
    });

    const apiSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
      vpc,
      description: 'Security group for FastAPI application',
      allowAllOutbound: true
    });

    // Allow API to connect to DB
    dbSecurityGroup.addIngressRule(
      apiSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow API access to PostgreSQL'
    );

    // Create database credentials
    const databaseCredentials = new secretsmanager.Secret(this, 'DBCredentials', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludePunctuation: true
      }
    });

    // Create RDS Aurora cluster
    const primaryDb = new rds.DatabaseCluster(this, 'PostgresCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_2
      }),
      credentials: rds.Credentials.fromSecret(databaseCredentials),
      instanceProps: {
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        },
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
        securityGroups: [dbSecurityGroup]
      },
      instances: 2, // One writer, one reader
      backup: {
        retention: Duration.days(7)
      },
      removalPolicy: RemovalPolicy.SNAPSHOT,
      defaultDatabaseName: 'postgres'
    });

    // Create ECR repository for FastAPI app
    const ecrRepo = new ecr.Repository(this, 'FastApiRepo', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteImages: true
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'ApiCluster', {
      vpc,
      containerInsights: true
    });

    // Create task role for FastAPI application
    const taskRole = new iam.Role(this, 'ApiTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    // Add permissions to access DB credentials
    databaseCredentials.grantRead(taskRole);

    // Create ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ApiALB', {
      vpc,
      internetFacing: true
    });

    // Create queue
    const queue = new sqs.Queue(this, 'AppReadWritePostgreStack1Queue', {
      visibilityTimeout: Duration.seconds(300)
    });

    // Create topic
    const topic = new sns.Topic(this, 'AppReadWritePostgreStack1Topic');

    topic.addSubscription(new subs.SqsSubscription(queue));

    // Create task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: taskRole
    });

    // Add container to task definition
    const container = taskDefinition.addContainer('FastApiContainer', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'FastApi' }),
      environment: {
        WRITER_DB_URL: `postgresql://${databaseCredentials.secretValueFromJson('username')}:${databaseCredentials.secretValueFromJson('password')}@${primaryDb.clusterEndpoint.hostname}:5432/postgres`,
        READER_DB_URL: `postgresql://${databaseCredentials.secretValueFromJson('username')}:${databaseCredentials.secretValueFromJson('password')}@${primaryDb.clusterReadEndpoint.hostname}:5432/postgres`
      },
      portMappings: [{ containerPort: 8000 }]
    });

    // Create ALB target group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargetGroup', {
      vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [],
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200'
      }
    });

    // Add listener to ALB
    const listener = alb.addListener('Listener', {
      port: 80,
      defaultTargetGroups: [targetGroup]
    });

    // Create ECS Service
    const service = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [apiSecurityGroup],
      assignPublicIp: false,
    });

    // Add service as target
    targetGroup.addTarget(service);

    // Create outputs
    new CfnOutput(this, 'DatabaseEndpoint', {
      value: primaryDb.clusterEndpoint.hostname
    });

    new CfnOutput(this, 'DatabaseReadEndpoint', {
      value: primaryDb.clusterEndpoint.hostname
    });

    new CfnOutput(this, 'ECRRepository', {
      value: ecrRepo.repositoryUri
    });

    new CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName
    });
  }
}
