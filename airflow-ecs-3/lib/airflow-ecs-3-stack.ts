import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";

export class AirflowEcs3Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Unique suffix for naming
    const uniqueSuffix = this.node.addr.substring(0, 8);

    // CDK asset for DAGs folder (uploads to S3)
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

    // Common task definition factory for Airflow components (webserver/scheduler)
    const createAirflowTaskDefinition = (component: string) => {
      const taskDef = new ecs.FargateTaskDefinition(this, `AirflowTaskDef-${component}-${uniqueSuffix}`, {
        memoryLimitMiB: 2048,
        cpu: 1024,
      });

      // Grant task role permissions to read DAGs from S3 asset bucket
      dagsAsset.grantRead(taskDef.taskRole);

      // Container definition
      const container = taskDef.addContainer(`AirflowContainer-${component}-${uniqueSuffix}`, {
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
          AIRFLOW_COMPONENT: component, // used by entrypoint script
          DAG_S3_BUCKET: dagsAsset.s3BucketName,
          DAG_S3_PREFIX: dagsAsset.s3ObjectKey,
        },
        logging: ecs.LogDriver.awsLogs({ streamPrefix: `Airflow-${component}-${uniqueSuffix}` }),
        // Override command to sync dags from S3 then start airflow component
        // command: [
        //   "/bin/sh",
        //   "-c",
        //   `
        //     mkdir -p /opt/airflow/dags && \
        //     apk add --no-cache aws-cli && \
        //     aws s3 cp s3://${dagsAsset.s3BucketName}/${dagsAsset.s3ObjectKey} /opt/airflow/dags/dags.zip && \
        //     unzip -o /opt/airflow/dags/dags.zip -d /opt/airflow/dags && \
        //     rm /opt/airflow/dags/dags.zip && \
        //     exec airflow $AIRFLOW_COMPONENT
        //   `,
        // ],
        command: [
          "/bin/sh",
          "-c",
          `
        mkdir -p /opt/airflow/dags && \
        apk add --no-cache aws-cli && \
        (
          while true; do
            aws s3 cp s3://${dagsAsset.s3BucketName}/${dagsAsset.s3ObjectKey} /opt/airflow/dags/dags.zip && \
            unzip -o /opt/airflow/dags/dags.zip -d /opt/airflow/dags && \
            rm /opt/airflow/dags/dags.zip
            sleep 120
          done
        ) & \
        exec airflow $AIRFLOW_COMPONENT
      `,
        ],

      });

      container.addPortMappings({ containerPort: component === "webserver" ? 8080 : 8793 });

      return { taskDef, container };
    };

    // Create webserver service with ALB
    const { taskDef: webserverTaskDef } = createAirflowTaskDefinition("webserver");

    new ecs_patterns.ApplicationLoadBalancedFargateService(this, `AirflowWebserverService-${uniqueSuffix}`, {
      cluster,
      taskDefinition: webserverTaskDef,
      publicLoadBalancer: true,
      desiredCount: 1,
      listenerPort: 80,
      // webserver listens on 8080, ALB forwards 80 -> 8080
    });

    // Create scheduler service (no ALB needed)
    const { taskDef: schedulerTaskDef } = createAirflowTaskDefinition("scheduler");

    new ecs.FargateService(this, `AirflowSchedulerService-${uniqueSuffix}`, {
      cluster,
      taskDefinition: schedulerTaskDef,
      desiredCount: 1,
      assignPublicIp: true,
      // Scheduler doesn't need load balancer, communicates internally
    });

    // Outputs
    // new CfnOutput(this, "WebserverURL", {
    //   value: `http://${cluster.vpc.vpcDefaultSecurityGroup.securityGroupId}`, // adjust as needed
    // });
  }
}
