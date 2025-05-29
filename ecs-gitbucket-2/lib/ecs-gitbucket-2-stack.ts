import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as logs from "aws-cdk-lib/aws-logs";

export class EcsGitbucket2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC with public and private subnets
    const vpc = new ec2.Vpc(this, "GitBucketVpc", {
      maxAzs: 2,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "GitBucketCluster", {
      vpc,
    });

    // (Optional) Secret placeholder for future RDS or admin secrets
    const adminSecret = new secretsmanager.Secret(
      this,
      "GitBucketAdminSecret",
      {
        secretName: "GitBucketAdminPassword",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "admin" }),
          generateStringKey: "password",
        },
      }
    );

    // Log group
    const logGroup = new logs.LogGroup(this, "GitBucketLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Fargate service + ALB
    /**
     *
     * default login credentials for GitBucket:
     *
     * Username: root, Password: root
     */
    const fargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "GitBucketService",
        {
          cluster,
          cpu: 512,
          memoryLimitMiB: 1024,
          desiredCount: 1,
          publicLoadBalancer: true,
          taskImageOptions: {
            image: ecs.ContainerImage.fromRegistry("gitbucket/gitbucket"),
            containerPort: 8080,
            environment: {
              // Configure GitBucket for proper Git operations
              GITBUCKET_HOME: "/gitbucket",
            },
            secrets: {
              // Example usage: expose secret to container if needed
              // GITBUCKET_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(adminSecret),
            },
            logDriver: ecs.LogDrivers.awsLogs({
              logGroup,
              streamPrefix: "GitBucket",
            }),
          },
        }
      );

    // Allow HTTP traffic for Git operations (GitBucket uses HTTP/HTTPS for Git push/pull)
    fargateService.service.connections.allowFromAnyIpv4(
      ec2.Port.tcp(8080),
      "Allow HTTP access for GitBucket web interface and Git operations"
    );

    new cdk.CfnOutput(this, "GitBucketURL", {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}`,
      description: "GitBucket Load Balancer URL",
    });

    new cdk.CfnOutput(this, "GitCloneURLFormat", {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}/git/{username}/{repository}.git`,
      description:
        "Git clone URL format - replace {username} and {repository} with actual values",
    });
  }
}
