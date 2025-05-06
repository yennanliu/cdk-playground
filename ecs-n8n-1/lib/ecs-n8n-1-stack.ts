import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";

export class EcsN8N1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC (with default 2 AZs)
    const vpc = new ec2.Vpc(this, "N8nVpc", {
      maxAzs: 2,
    });

    // 2. ECS Cluster
    const cluster = new ecs.Cluster(this, "N8nCluster", {
      vpc,
    });

    // 3. Fargate Service with ALB
    new ecs_patterns.ApplicationLoadBalancedFargateService(this, "N8nService", {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      publicLoadBalancer: true,
      taskImageOptions: {
        containerPort: 5678,
        image: ecs.ContainerImage.fromRegistry("n8nio/n8n:latest"),
        environment: {
          // Optional: Add env vars for credentials, webhook base, etc.
          N8N_BASIC_AUTH_ACTIVE: "true",
          N8N_BASIC_AUTH_USER: "admin",
          N8N_BASIC_AUTH_PASSWORD: "admin",
        },
      },
    });
  }
}
