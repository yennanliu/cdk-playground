import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class MlflowStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. VPC with two public subnets for simplicity
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

    // 2. S3 bucket for MLflow artifacts
    const s3Bucket = new s3.Bucket(this, "MlflowArtifactBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 3. RDS MySQL instance as the backend metadata store
    const dbName = "mlflowdb";
    const rdsInstance = new rds.DatabaseInstance(this, "MlflowRdsInstance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: {
        // Placing the DB in a public subnet for simplicity as requested.
        // For production, it's highly recommended to use private subnets.
        subnetType: ec2.SubnetType.PUBLIC,
      },
      databaseName: dbName,
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // 4. ECS Cluster
    const cluster = new ecs.Cluster(this, "MlflowCluster", {
      vpc,
    });

    // 5. ECS Fargate service with Application Load Balancer
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
            secrets: {
              DB_USERNAME: ecs.Secret.fromSecretsManager(
                rdsInstance.secret!,
                "username"
              ),
              DB_PASSWORD: ecs.Secret.fromSecretsManager(
                rdsInstance.secret!,
                "password"
              ),
            },
          },
          taskSubnets: {
            subnetType: ec2.SubnetType.PUBLIC,
          },
          assignPublicIp: true, // Required for Fargate tasks in public subnets to pull images
          publicLoadBalancer: true,
          listenerPort: 80,
        }
      );

    // Add environment variables to the container
    const container = fargateService.taskDefinition.defaultContainer!;
    container.addEnvironment("DB_HOST", rdsInstance.dbInstanceEndpointAddress);
    container.addEnvironment("DB_NAME", dbName);
    container.addEnvironment(
      "DEFAULT_ARTIFACT_ROOT",
      s3Bucket.s3UrlForObject()
    );

    // Override the container command to start the MLflow server correctly
    // The MLflow container's entrypoint is a script that expects the command arguments directly.
    const cfnTaskDefinition = fargateService.taskDefinition.node
      .defaultChild as ecs.CfnTaskDefinition;
    cfnTaskDefinition.addPropertyOverride("ContainerDefinitions.0.Command", [
      "mlflow",
      "server",
      "--host",
      "0.0.0.0",
      "--port",
      "5000",
      "--backend-store-uri",
      `mysql+pymysql://$(DB_USERNAME):$(DB_PASSWORD)@$(DB_HOST):3306/${dbName}`,
      "--default-artifact-root",
      s3Bucket.s3UrlForObject(),
    ]);

    // 6. Security group configuration
    rdsInstance.connections.allowDefaultPortFrom(
      fargateService.service.connections
    );

    // 7. IAM permissions
    s3Bucket.grantReadWrite(fargateService.taskDefinition.taskRole);

    // Output the ALB DNS name
    new CfnOutput(this, "MlflowAlbDns", {
      value: fargateService.loadBalancer.loadBalancerDnsName,
    });
  }
}
