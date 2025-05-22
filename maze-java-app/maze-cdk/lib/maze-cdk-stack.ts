import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class MazeCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // const queue = new sqs.Queue(this, 'MazeCdkQueue', {
    //   visibilityTimeout: Duration.seconds(300)
    // });

    // const topic = new sns.Topic(this, 'MazeCdkTopic');

    // topic.addSubscription(new subs.SqsSubscription(queue));

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'MazeVpc', {
      maxAzs: 2 // Default is all AZs in the region
    });

    // Create an ECR repository
    // const repository = new ecr.Repository(this, 'MazeEcrRepo');

    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'MazeEcsCluster', {
      vpc: vpc
    });

    // Define a Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MazeTaskDef');

    // Add a container to the task definition
    const container = taskDefinition.addContainer('MazeContainer', {
      image: ecs.ContainerImage.fromRegistry('yennanliu/maze-app:latest'),
      memoryLimitMiB: 512,
      cpu: 256,
    });

    container.addPortMappings({
      containerPort: 80,
    });

    // Update ECS service to map container port 8080 to ALB port 80
    container.addPortMappings({
      containerPort: 8080,
      hostPort: 8080, // Map container port 8080 to host port 8080
      protocol: ecs.Protocol.TCP
    });

    // Create an ECS service
    const service = new ecs.FargateService(this, 'MazeService', {
      cluster,
      taskDefinition
    });

    // Create an Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'MazeALB', {
      vpc,
      internetFacing: true
    });

    // Add a listener to the ALB
    const listener = alb.addListener('MazeListener', {
      port: 80
    });

    // Update ALB listener to forward traffic from port 80 to port 8080
    listener.addTargets('MazeEcsTargets', {
      port: 80, // ALB listens on port 80
      targets: [service],
      healthCheck: {
        port: '8080', // Health check on the backend app's port
        path: '/',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2
      }
    });

    // Create an S3 bucket
    const bucket = new s3.Bucket(this, 'MazeBucket', {
      versioned: true
    });
  }
}
