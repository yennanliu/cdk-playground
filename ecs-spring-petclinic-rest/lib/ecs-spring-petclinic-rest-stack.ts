import { Stack, StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  Vpc,
  SubnetType,
  SecurityGroup,
  Peer,
  Port,
} from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDrivers,
  Protocol,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  ListenerAction,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  Credentials,
} from "aws-cdk-lib/aws-rds";
import { InstanceType, InstanceClass, InstanceSize } from "aws-cdk-lib/aws-ec2";
import { SecretValue } from "aws-cdk-lib";

export class EcsSpringPetclinicRestStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. VPC
    const vpc = new Vpc(this, "AppVpc", {
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: SubnetType.PUBLIC,
        },
        {
          name: "private",
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // 2. RDS (PostgreSQL)
    const dbSecurityGroup = new SecurityGroup(this, "DbSG", {
      vpc,
      description: "Allow ECS to access RDS",
      allowAllOutbound: true,
    });

    const db = new DatabaseInstance(this, "JavaAppDb", {
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_15,
      }),
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      credentials: Credentials.fromGeneratedSecret("postgres"),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      securityGroups: [dbSecurityGroup],
      databaseName: "javaapp",
      removalPolicy: RemovalPolicy.DESTROY, // NOT FOR PRODUCTION
      publiclyAccessible: false,
    });

    // 3. ECS Cluster
    const cluster = new Cluster(this, "AppCluster", { vpc });

    // 4. Fargate Task
    const taskDef = new FargateTaskDefinition(this, "JavaAppTask", {
      memoryLimitMiB: 1024,
      cpu: 512,
    });

    taskDef.addContainer("AppContainer", {
      //image: ContainerImage.fromRegistry("openjdk:17"), // Replace with your app image
      image: ContainerImage.fromRegistry('springcommunity/spring-petclinic-rest'),
      logging: LogDrivers.awsLogs({ streamPrefix: "App" }),
      environment: {
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_USER: "postgres",
        DB_NAME: "javaapp",
        SPRING_PROFILES_ACTIVE: "postgresql",
        SERVER_SERVLET_CONTEXT_PATH: "/petclinic",
        SERVER_PORT: "9966",
        // Use Secrets Manager in real app for password
      },
      portMappings: [
        {
          containerPort: 9966,
          protocol: Protocol.TCP,
        }
      ],
    });

    // 5. ECS Service + SG
    const appSG = new SecurityGroup(this, "AppSG", {
      vpc,
      description: "App access to DB",
      allowAllOutbound: true,
    });

    // Allow app SG to connect to DB SG
    dbSecurityGroup.addIngressRule(
      appSG,
      Port.tcp(5432),
      "App access to Postgres"
    );

    const service = new FargateService(this, "JavaAppService", {
      cluster,
      taskDefinition: taskDef,
      assignPublicIp: true,
      securityGroups: [appSG],
    });

    // 6. Load Balancer
    const lb = new ApplicationLoadBalancer(this, "AppLB", {
      vpc,
      internetFacing: true,
      loadBalancerName: "JavaAppLB",
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });

    const listener = lb.addListener("AppListener", {
      port: 80,
      open: true,
    });

    listener.addTargets("AppTargets", {
      port: 80,
      targets: [service],
      healthCheck: {
        path: "/petclinic/api",
        interval: Duration.seconds(60),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
    });
  }
}
