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
import { InstanceType, InstanceClass, InstanceSize } from "aws-cdk-lib/aws-ec2";

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

    // 2. ECS Cluster
    const cluster = new Cluster(this, "AppCluster", { vpc });

    // 3. Fargate Task
    const taskDef = new FargateTaskDefinition(this, "JavaAppTask", {
      memoryLimitMiB: 1024,
      cpu: 512,
    });

    taskDef.addContainer("AppContainer", {
      image: ContainerImage.fromRegistry('springcommunity/spring-petclinic-rest'),
      logging: LogDrivers.awsLogs({ streamPrefix: "App" }),
      environment: {
        SPRING_PROFILES_ACTIVE: "default", // Use default H2 database profile
        SERVER_SERVLET_CONTEXT_PATH: "/petclinic",
        SERVER_PORT: "9966",
      },
      portMappings: [
        {
          containerPort: 9966,
          protocol: Protocol.TCP,
        }
      ],
    });

    // 4. ECS Service Security Group
    const appSG = new SecurityGroup(this, "AppSG", {
      vpc,
      description: "App security group",
      allowAllOutbound: true,
    });

    // 5. ECS Service
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
