import { Duration, Stack, StackProps } from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";

export class EcsTest2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Create a VPC with default settings
    const vpc = new ec2.Vpc(this, "MyVpc", { maxAzs: 2 });

    // 2. Create an ECS Cluster in the VPC
    const cluster = new ecs.Cluster(this, "MyCluster", {
      vpc: vpc,
    });

    // 3. Create a Fargate Service with a Load Balancer
    new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "MyFargateService",
      {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 1,
        publicLoadBalancer: true,
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry("nginx"), // You can replace this with your image
        },
      }
    );
  }
}
