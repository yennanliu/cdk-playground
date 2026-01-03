import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class YtStreamStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3 bucket for music files and background images
    const musicBucket = new s3.Bucket(this, 'MusicBucket', {
      bucketName: `yt-stream-music-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Secret for YouTube stream key
    const streamKeySecret = new secretsmanager.Secret(this, 'YouTubeStreamKey', {
      secretName: 'youtube-stream-key',
      description: 'YouTube RTMP stream key',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ streamKey: 'PLACEHOLDER' }),
        generateStringKey: 'placeholder',
      },
    });

    // Use default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', {
      isDefault: true,
    });

    // Security group for ECS task
    const securityGroup = new ec2.SecurityGroup(this, 'StreamerSecurityGroup', {
      vpc,
      description: 'Security group for YouTube streaming ECS task',
      allowAllOutbound: true, // Allow RTMP egress to YouTube
    });

    // ECS cluster
    const cluster = new ecs.Cluster(this, 'StreamCluster', {
      vpc,
      clusterName: 'yt-stream-cluster',
    });

    // CloudWatch log group
    const logGroup = new logs.LogGroup(this, 'StreamerLogGroup', {
      logGroupName: '/ecs/youtube-streamer',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Task execution role (for pulling images, logging, secrets)
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Grant secret read access to execution role
    streamKeySecret.grantRead(executionRole);

    // Task role (for S3 access during runtime)
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant S3 read access to task role
    musicBucket.grantRead(taskRole);

    // Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'StreamerTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole,
    });

    // Add container to task definition
    const container = taskDefinition.addContainer('ffmpeg-streamer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', 'docker')),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'youtube-streamer',
        logGroup,
      }),
      environment: {
        MUSIC_BUCKET: musicBucket.bucketName,
        AWS_REGION: this.region,
      },
      secrets: {
        YOUTUBE_STREAM_KEY: ecs.Secret.fromSecretsManager(streamKeySecret, 'streamKey'),
      },
    });

    // ECS Fargate service
    const service = new ecs.FargateService(this, 'StreamerService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      serviceName: 'youtube-streamer-service',
      assignPublicIp: true, // Required for internet access without NAT Gateway
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      enableExecuteCommand: true, // Enable ECS Exec for debugging
    });

    // Output bucket name
    new CfnOutput(this, 'MusicBucketName', {
      value: musicBucket.bucketName,
      description: 'S3 bucket for music files',
    });

    // Output secret ARN
    new CfnOutput(this, 'StreamKeySecretArn', {
      value: streamKeySecret.secretArn,
      description: 'Secrets Manager secret for YouTube stream key',
    });

    // Output cluster name
    new CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
    });

    // Output service name
    new CfnOutput(this, 'ServiceName', {
      value: service.serviceName,
      description: 'ECS service name',
    });
  }
}
