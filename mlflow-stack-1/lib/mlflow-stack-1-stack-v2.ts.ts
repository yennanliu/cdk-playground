import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";

export class MlflowEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, "MlflowVpc", {
      maxAzs: 2,
      natGateways: 0,
    });

    // S3 Bucket for MLflow artifacts
    const artifactBucket = new s3.Bucket(this, "MlflowArtifacts", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "MlflowCluster", {
      vpc,
    });

    // Task Role with S3 Access
    const taskRole = new iam.Role(this, "MlflowTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    artifactBucket.grantReadWrite(taskRole);

    // Fargate Service running MLflow
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "MlflowService", {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      publicLoadBalancer: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      taskImageOptions: {
        // ghcr.io/mlflow/mlflow
        image: ecs.ContainerImage.fromRegistry("ghcr.io/mlflow/mlflow"),
        containerPort: 5000,
        environment: {
          MLFLOW_S3_ENDPOINT_URL: `https://s3.${this.region}.amazonaws.com`,
          BACKEND_STORE_URI: "sqlite:///mlflow.db",
        },
        command: [
          "mlflow", "server",
          "--host", "0.0.0.0",
          "--port", "5000",
          "--backend-store-uri", "sqlite:///mlflow.db",
          "--default-artifact-root", `s3://${artifactBucket.bucketName}/`
        ],
        taskRole,
      },
    });

    // Output
    new cdk.CfnOutput(this, "MLflowEndpoint", {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}`,
    });
  }
}
