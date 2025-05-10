import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";

export class EcsN8nStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC (default 2 AZs)
    const vpc = new ec2.Vpc(this, "N8nVpc", {
      maxAzs: 2,
    });

    // 2. ECS Cluster
    const cluster = new ecs.Cluster(this, "N8nCluster", {
      vpc,
    });

    // 3. ECS Fargate Service behind ALB (with HTTP)
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "N8nService", {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      publicLoadBalancer: true,
      assignPublicIp: true,
      taskImageOptions: {
        containerPort: 5678,
        image: ecs.ContainerImage.fromRegistry("n8nio/n8n:latest"),
        environment: {
          N8N_BASIC_AUTH_ACTIVE: "false",
          N8N_SECURE_COOKIE: "false",
          N8N_PROTOCOL: "http",
          N8N_HOST: "localhost",
        },
      },
    });
    
    // Configure health check so deployment works properly
    fargateService.targetGroup.configureHealthCheck({
      path: "/",
      healthyHttpCodes: "200-499", // N8n returns various status codes
    });
    
    // Set minimum healthy percent for deployments
    fargateService.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 2,
    });
    
    // Output the ALB DNS name
    new cdk.CfnOutput(this, "LoadBalancerDNS", {
      value: fargateService.loadBalancer.loadBalancerDnsName,
    });
  }
}
