import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class MazeCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. Create a VPC
    const vpc = new ec2.Vpc(this, 'MazeVpc', {
      maxAzs: 2
    });

    // 2. Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'MazeEcsCluster', {
      vpc
    });

    // 3. Define a Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MazeTaskDef');

    // 4. Add container exposing port 8080
    const container = taskDefinition.addContainer('MazeContainer', {
      image: ecs.ContainerImage.fromRegistry('yennanliu/maze-app:latest'),
      memoryLimitMiB: 512,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'MazeApp' })
    });

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP
    });

    // 5. Create ECS service
    const service = new ecs.FargateService(this, 'MazeService', {
      cluster,
      taskDefinition,
      assignPublicIp: true // Required if no NAT gateway
    });

    // 6. Create public-facing ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'MazeALB', {
      vpc,
      internetFacing: true
    });

    // 7. Add HTTP listener (port 80)
    const listener = alb.addListener('MazeListener', {
      port: 80,
      open: true
    });

    // 8. Forward ALB traffic to ECS container on port 8080
    listener.addTargets('MazeEcsTargets', {
      port: 8080, // match container's port
      targets: [service],
      healthCheck: {
        port: '8080',
        path: '/',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2
      }
    });

    // 9. Optional: S3 bucket
    const bucket = new s3.Bucket(this, 'MazeBucket', {
      versioned: true
    });
  }
}
