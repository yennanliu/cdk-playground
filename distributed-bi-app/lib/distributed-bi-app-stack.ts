import * as cdk from "aws-cdk-lib";
import {
  Vpc,
  InstanceType,
  InstanceClass,
  InstanceSize,
  SubnetType,
  Port,
} from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerImage,
  FargateTaskDefinition,
  FargateService,
  AwsLogDriver,
} from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  ApplicationProtocol,
  ApplicationTargetGroup,
  ListenerAction,
  Protocol,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  Credentials,
} from "aws-cdk-lib/aws-rds";
import { SecretValue, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Protocol as EcsProtocol } from "aws-cdk-lib/aws-ecs";
import { LoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancing";

export class DistributedBiAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC
    const vpc = new Vpc(this, "RedashVpc", {
      maxAzs: 2,
      subnetConfiguration: [
        { name: "public", subnetType: SubnetType.PUBLIC },
        { name: "private", subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      ],
    });

    // for debug ONLY
    const subnets = vpc.selectSubnets({
      subnetType: SubnetType.PRIVATE_WITH_EGRESS,
    });
    console.log(subnets.subnetIds);

    // 2. RDS PostgreSQL
    const db = new DatabaseInstance(this, "RedashPostgres", {
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_15,
      }),
      // vpc: The VPC to place the RDS instance in
      vpc,
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      // vpcSubnets: A filter to choose which subnets inside that VPC to use
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      publiclyAccessible: false,
      multiAz: false,
      credentials: Credentials.fromGeneratedSecret("postgres"),
      databaseName: "redash",
    });

    // 3. ECS Cluster
    const cluster = new Cluster(this, "RedashCluster", { vpc });

    // 4. Fargate Task Definition
    /**
     * 1) FargateTaskDefinition is your compute + runtime config
     * 2)  A FargateTaskDefinition is a blueprint that defines:
     *      •	CPU & memory for the task (required in Fargate)
     *     	•	CPU & memory for the task (required in Fargate)
     *      •	Docker containers that run inside the task
     *      •	Environment variables
     *      •	Volumes
     *      •	Networking mode
     *      •	Logging configuration
     *
     */
    const taskDef = new FargateTaskDefinition(this, "RedashTask", {
      memoryLimitMiB: 1024, // 👈 Task-level memory
      cpu: 512, // 👈 Task-level CPU (optional but good)
    });

    const container = taskDef.addContainer("RedashContainer", {
      image: ContainerImage.fromRegistry("redash/redash:latest"),
      memoryLimitMiB: 1024,
      logging: new AwsLogDriver({ streamPrefix: "redash" }),
      environment: {
        REDASH_DATABASE_URL: db
          .secret!.secretValueFromJson("username")
          .unsafeUnwrap()
          ? `postgresql://postgres:${db
              .secret!.secretValueFromJson("password")
              .unsafeUnwrap()}@${db.dbInstanceEndpointAddress}:5432/redash`
          : "",
        REDASH_LOG_LEVEL: "INFO",
        PYTHONUNBUFFERED: "0",
      },
    });

    // container.addPortMappings({
    //   containerPort: 5000, // Redash web UI port
    //   protocol: Protocol.TCP,
    // });

    container.addPortMappings({
      containerPort: 5000,
      protocol: EcsProtocol.TCP,
    });

    // 5. ECS Fargate Service
    const service = new FargateService(this, "RedashService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      assignPublicIp: true,
    });

    // 6. Load Balancer
    const alb = new ApplicationLoadBalancer(this, "RedashAlb", {
      vpc,
      internetFacing: true,
    });

    const alb2 = new LoadBalancer(this, "RedashAlb", {
      vpc,
      internetFacing: true,
    });

    const listener = alb.addListener("HttpListener", {
      port: 80,
      open: true,
    });

    // listener.addTargets('RedashTargets', {
    //   port: 5000,
    //   targets: [service],
    //   healthCheck: {
    //     path: '/',
    //     interval: Duration.seconds(30),
    //     timeout: Duration.seconds(5),
    //     healthyHttpCodes: '200',
    //   },
    // });

    listener.addTargets("RedashTargets", {
      port: 5000,
      protocol: ApplicationProtocol.HTTP, // 👈 ADD THIS LINE
      targets: [service],
      healthCheck: {
        path: "/",
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyHttpCodes: "200",
      },
    });

    // Allow ECS service to connect to DB
    db.connections.allowDefaultPortFrom(service);

    // 7. Output the public URL
    new cdk.CfnOutput(this, "RedashURL", {
      value: `http://${alb.loadBalancerDnsName}`,
    });
  }
}
