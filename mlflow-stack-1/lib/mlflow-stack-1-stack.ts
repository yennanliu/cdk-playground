import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class MlflowStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. VPC with two public subnets
    const vpc = new ec2.Vpc(this, "MlflowVpc", {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public-subnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });
    vpc.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // 2. S3 bucket for MLflow artifacts
    const s3Bucket = new s3.Bucket(this, "MlflowArtifactBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 3. ECS Cluster
    const cluster = new ecs.Cluster(this, "MlflowCluster", {
      vpc,
    });

    // 4. ECS Fargate service with Application Load Balancer
    const fargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "MlflowFargateService",
        {
          cluster,
          cpu: 256,
          memoryLimitMiB: 512,
          desiredCount: 1,
          taskImageOptions: {
            image: ecs.ContainerImage.fromRegistry(
              "ghcr.io/mlflow/mlflow:v2.12.1"
            ),
            containerPort: 5000,
          },
          taskSubnets: {
            subnetType: ec2.SubnetType.PUBLIC,
          },
          assignPublicIp: true,
          publicLoadBalancer: true,
          listenerPort: 80,
        }
      );

    // Override the container command to start the MLflow server with S3 artifact store
    const cfnTaskDefinition = fargateService.taskDefinition.node
      .defaultChild as ecs.CfnTaskDefinition;
    cfnTaskDefinition.addPropertyOverride("ContainerDefinitions.0.Command", [
      "sh",
      "-c",
      `mlflow server --host 0.0.0.0 --port 5000 --default-artifact-root ${s3Bucket.s3UrlForObject()}`,
    ]);

    // Grant IAM permissions for the ECS task to access the S3 bucket
    s3Bucket.grantReadWrite(fargateService.taskDefinition.taskRole);

    // Output the ALB DNS name
    new CfnOutput(this, "MlflowAlbDns", {
      value: fargateService.loadBalancer.loadBalancerDnsName,
    });
  }
}
