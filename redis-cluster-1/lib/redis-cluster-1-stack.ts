import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';

export class RedisCluster1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC with public and private subnets across multiple AZs
    const vpc = new ec2.Vpc(this, 'AppVpc', {
      maxAzs: 2,
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
        },
      ],
    });

    // Security group for Django (ECS)
    const djangoSg = new ec2.SecurityGroup(this, 'DjangoEcsSg', {
      vpc,
      description: 'Allow HTTP/HTTPS',
      allowAllOutbound: true,
    });
    djangoSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');
    djangoSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');

    // Security group for Redis (ECS)
    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc,
      description: 'Allow Redis from EC2 only',
      allowAllOutbound: true,
    });
    redisSg.addIngressRule(djangoSg, ec2.Port.tcp(6379), 'Allow Redis from Django ECS SG');

    // IAM role for EC2 instance
    const ec2Role = new iam.Role(this, 'DjangoEc2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Key pair for EC2 (user must create/import key manually and provide name)
    //const keyName = 'yen-wipro-aws-dev-key-2'; // <-- replace with your key pair name

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'RedisCluster', {
      vpc,
    });

    // CloudWatch log group for Redis
    const redisLogGroup = new logs.LogGroup(this, 'RedisLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // ECS Fargate Task Definition for Redis
    const redisTaskDef = new ecs.FargateTaskDefinition(this, 'RedisTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
    });
    redisTaskDef.addContainer('RedisContainer', {
      image: ecs.ContainerImage.fromRegistry('redis:7'),
      logging: ecs.LogDriver.awsLogs({
        logGroup: redisLogGroup,
        streamPrefix: 'redis',
      }),
      portMappings: [{ containerPort: 6379 }],
    });

    // ECS Fargate Service for Redis (3 nodes)
    new ecs.FargateService(this, 'RedisFargateService', {
      cluster,
      taskDefinition: redisTaskDef,
      assignPublicIp: true,
      desiredCount: 3, // updated to 3 nodes
      securityGroups: [redisSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // ECS Fargate Task Definition for Django
    const djangoTaskDef = new ecs.FargateTaskDefinition(this, 'DjangoTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
    });
    djangoTaskDef.addContainer('DjangoContainer', {
      image: ecs.ContainerImage.fromRegistry('yennanliu/mydjangoapp:dev-2'),
      environment: {
        REDIS_HOST: 'redis', // Use service discovery or update with actual endpoint if needed
        REDIS_PORT: '6379',
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'django',
      }),
      portMappings: [{ containerPort: 80 }],
    });

    // Application Load Balancer for Django ECS
    const alb = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'DjangoAlbFargateService', {
      cluster,
      taskDefinition: djangoTaskDef,
      publicLoadBalancer: true,
      desiredCount: 1,
      securityGroups: [djangoSg],
      assignPublicIp: true,
      listenerPort: 80,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      healthCheckGracePeriod: Duration.seconds(120),
    });

    // Set health check path to Django default ('/')
    alb.targetGroup.configureHealthCheck({
      path: '/',
      port: '80',
      healthyHttpCodes: '200-399',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Output the Load Balancer DNS name
    new CfnOutput(this, 'DjangoAlbUrl', {
      value: alb.loadBalancer.loadBalancerDnsName,
      description: 'The URL of the Django Application Load Balancer',
    });
  }
}
