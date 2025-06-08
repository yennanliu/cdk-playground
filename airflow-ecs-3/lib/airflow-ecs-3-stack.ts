import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";

export class AirflowEcs3Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, "AirflowVpc", {
      maxAzs: 2,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "AirflowCluster", {
      vpc: vpc,
    });

    // RDS PostgreSQL
    const dbCredentialsSecret = new secretsmanager.Secret(
      this,
      "DBCredentialsSecret",
      {
        secretName: "airflow-db-credentials",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "airflow" }),
          excludePunctuation: true,
          includeSpace: false,
          generateStringKey: "password",
        },
      }
    );

    const database = new rds.DatabaseInstance(this, "AirflowRDS", {
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
      removalPolicy: rds.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // ECS Task Definition with DAGs from CDK Asset
    const taskDef = new ecs.FargateTaskDefinition(this, "AirflowTaskDef");

    const airflowContainer = taskDef.addContainer("AirflowWebserver", {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, "../airflow")), // assumes Dockerfile in ../airflow
      memoryLimitMiB: 1024,
      environment: {
        AIRFLOW__CORE__EXECUTOR: "LocalExecutor",
        AIRFLOW__CORE__SQL_ALCHEMY_CONN: `postgresql+psycopg2://airflow:${dbCredentialsSecret
          .secretValueFromJson("password")
          .unsafeUnwrap()}@${database.dbInstanceEndpointAddress}:5432/airflow`,
        AIRFLOW__WEBSERVER__RBAC: "True",
      },
      logging: ecs.LogDriver.awsLogs({ streamPrefix: "Airflow" }),
    });

    airflowContainer.addPortMappings({
      containerPort: 8080,
    });

    // Load Balanced Fargate Service
    new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "AirflowService",
      {
        cluster,
        taskDefinition: taskDef,
        publicLoadBalancer: true,
      }
    );
  }
}
