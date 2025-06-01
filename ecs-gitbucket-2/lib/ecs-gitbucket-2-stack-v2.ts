import {
  StackProps,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_efs as efs,
  aws_ecs_patterns as ecs_patterns,
  aws_elasticloadbalancingv2 as elbv2,
} from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

// EcsGitbucket2Stack V2 (created by gpt)
export class EcsGitbucket2StackV2 extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "GitBucketVpc", {
      maxAzs: 2,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: "Database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, "GitBucketCluster", {
      vpc,
    });

    const efsSecurityGroup = new ec2.SecurityGroup(this, "EFSSecurityGroup", {
      vpc,
      description: "Allow NFS access",
      allowAllOutbound: true,
    });

    const ecsSecurityGroup = new ec2.SecurityGroup(this, "ECSSecurityGroup", {
      vpc,
      description: "Allow ECS outbound",
      allowAllOutbound: true,
    });

    efsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(2049),
      "Allow ECS to access EFS"
    );

    ecsSecurityGroup.addEgressRule(
      efsSecurityGroup,
      ec2.Port.tcp(2049),
      "Allow ECS to connect to EFS"
    );

    const fileSystem = new efs.FileSystem(this, "GitBucketEFS", {
      vpc,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      securityGroup: efsSecurityGroup,
    });

    const volumeName = "efsVolume";

    const fargateTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "GitBucketTaskDef",
      {
        memoryLimitMiB: 2048,
        cpu: 1024,
      }
    );

    fargateTaskDefinition.addVolume({
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        rootDirectory: "/",
        transitEncryption: "ENABLED",
      },
    });

    const container = fargateTaskDefinition.addContainer("GitBucketContainer", {
      image: ecs.ContainerImage.fromRegistry("gitbucket/gitbucket"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "GitBucket" }),
    });

    container.addPortMappings({
      containerPort: 8080,
    });

    container.addMountPoints({
      containerPath: "/gitbucket",
      sourceVolume: volumeName,
      readOnly: false,
    });

    const fargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "GitBucketFargateService",
        {
          cluster,
          cpu: 1024,
          desiredCount: 1,
          memoryLimitMiB: 2048,
          taskDefinition: fargateTaskDefinition,
          publicLoadBalancer: true,
          taskSubnets: {
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
          securityGroups: [ecsSecurityGroup],
          assignPublicIp: false, // Good practice for private subnets
        }
      );

    // Ensure the EFS mount target is created in each subnet where the service can run
    fileSystem.connections.allowDefaultPortFrom(fargateService.service);

    new elbv2.ApplicationListenerRule(this, "GitBucketRedirect", {
      listener: fargateService.listener,
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(["*"])],
      action: elbv2.ListenerAction.forward([fargateService.targetGroup]),
    });
  }
}
