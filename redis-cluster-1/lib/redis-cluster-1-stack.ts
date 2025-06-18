import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
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

    // Security group for EC2 (Django)
    const ec2Sg = new ec2.SecurityGroup(this, 'DjangoEc2Sg', {
      vpc,
      description: 'Allow HTTP/HTTPS and SSH',
      allowAllOutbound: true,
    });
    ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');
    ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');
    ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH');

    // Security group for Redis (ECS)
    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc,
      description: 'Allow Redis from EC2 only',
      allowAllOutbound: true,
    });
    redisSg.addIngressRule(ec2Sg, ec2.Port.tcp(6379), 'Allow Redis from EC2 SG');

    // IAM role for EC2 instance
    const ec2Role = new iam.Role(this, 'DjangoEc2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Key pair for EC2 (user must create/import key manually and provide name)
    const keyName = 'yen-wipro-aws-dev-key-2.pem'; // <-- replace with your key pair name

    // EC2 instance for Django
    const ec2Instance = new ec2.Instance(this, 'DjangoInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: ec2Sg,
      role: ec2Role,
      keyName,
    });

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

    // ECS Fargate Service for Redis
    new ecs.FargateService(this, 'RedisFargateService', {
      cluster,
      taskDefinition: redisTaskDef,
      assignPublicIp: true,
      desiredCount: 1,
      securityGroups: [redisSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const queue = new sqs.Queue(this, 'RedisCluster1Queue', {
      visibilityTimeout: Duration.seconds(300)
    });

    const topic = new sns.Topic(this, 'RedisCluster1Topic');

    topic.addSubscription(new subs.SqsSubscription(queue));
  }
}
