import {
  Stack,
  StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";

export class AirflowEcs3Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Generate a unique suffix for resource names
    const uniqueSuffix = this.node.addr.substring(0, 8);

    // Create an asset for DAGs
    const dagsAsset = new s3assets.Asset(this, "DagsAsset", {
      path: path.join(__dirname, "dags"),
    });

    // VPC
    const vpc = new ec2.Vpc(this, `AirflowVpc-${uniqueSuffix}`, {
      maxAzs: 2,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, `AirflowCluster-${uniqueSuffix}`, {
      vpc: vpc,
    });

    // RDS PostgreSQL
    const dbCredentialsSecret = new secretsmanager.Secret(
      this,
      `DBCredentialsSecret-${uniqueSuffix}`,
      {
        secretName: `airflow-db-credentials-${uniqueSuffix}`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "airflow" }),
          excludePunctuation: true,
          includeSpace: false,
          generateStringKey: "password",
        },
      }
    );

    const database = new rds.DatabaseInstance(this, `AirflowRDS-${uniqueSuffix}`, {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_13,
      }),
      vpc,
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      databaseName: "airflow",
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: 20,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publiclyAccessible: true,
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // ECS Task Definition with DAGs from CDK Asset
    const taskDef = new ecs.FargateTaskDefinition(this, `AirflowTaskDef-${uniqueSuffix}`, {
      memoryLimitMiB: 2048,  // Set task memory limit to 2GB
      cpu: 1024,            // Set CPU units (1024 = 1 vCPU)
    });

    const airflowContainer = taskDef.addContainer(`AirflowWebserver-${uniqueSuffix}`, {
      image: ecs.ContainerImage.fromRegistry("apache/airflow:2.8.1"),
      memoryLimitMiB: 1024,
      environment: {
        AIRFLOW__CORE__EXECUTOR: "LocalExecutor",
        AIRFLOW__CORE__SQL_ALCHEMY_CONN: `postgresql+psycopg2://airflow:${dbCredentialsSecret
          .secretValueFromJson("password")
          .unsafeUnwrap()}@${database.dbInstanceEndpointAddress}:5432/airflow`,
        AIRFLOW__WEBSERVER__RBAC: "True",
        AIRFLOW__CORE__LOAD_EXAMPLES: "False",
        AIRFLOW_HOME: "/opt/airflow",
        AIRFLOW__CORE__DAGS_FOLDER: "/opt/airflow/dags",
      },
      logging: ecs.LogDriver.awsLogs({ streamPrefix: `Airflow-${uniqueSuffix}` }),
    });

    // Grant task execution role permissions to access the S3 asset
    dagsAsset.grantRead(taskDef.executionRole!);

    // Add the volume to task definition using bind mount
    taskDef.addVolume({
      name: "dags",
      host: {
        sourcePath: "/opt/airflow/dags"
      }
    });

    airflowContainer.addPortMappings({
      containerPort: 8080,
    });

    // Load Balanced Fargate Service
    new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      `AirflowService-${uniqueSuffix}`,
      {
        cluster,
        taskDefinition: taskDef,
        publicLoadBalancer: true,
      }
    );
  }
}
