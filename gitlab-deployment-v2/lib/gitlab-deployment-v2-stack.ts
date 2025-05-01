import { Stack, StackProps, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cdk from 'aws-cdk-lib';

export class GitlabDeploymentV2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'GitLabVpc', {
      maxAzs: 2,
      natGateways: 1
    });

    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'GitLabCluster', {
      vpc: vpc,
      containerInsights: true
    });

    // Create an EFS file system for GitLab persistent storage
    const fileSystem = new efs.FileSystem(this, 'GitLabEfsFileSystem', {
      vpc: vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      encrypted: true,
      removalPolicy: RemovalPolicy.RETAIN
    });

    // Security group for the EFS mount targets
    const efsSecurityGroup = new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
      vpc: vpc,
      description: 'Allow EFS access from ECS tasks',
      allowAllOutbound: true
    });

    // Security group for the GitLab service
    const gitlabServiceSG = new ec2.SecurityGroup(this, 'GitLabServiceSG', {
      vpc: vpc,
      description: 'Security group for GitLab service',
      allowAllOutbound: true
    });

    // Allow EFS access from the GitLab Service Security Group
    efsSecurityGroup.addIngressRule(
      gitlabServiceSG,
      ec2.Port.tcp(2049),
      'Allow NFS access from the GitLab service'
    );

    // Allow inbound HTTP traffic to the GitLab service
    gitlabServiceSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic'
    );

    gitlabServiceSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic'
    );

    gitlabServiceSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH traffic'
    );

    // Create an Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'GitLabALB', {
      vpc: vpc,
      internetFacing: true
    });

    // Add a listener on port 80
    const listener = alb.addListener('PublicListener', {
      port: 80,
      open: true,
    });

    // Create a Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'GitLabTaskDef', {
      memoryLimitMiB: 4096,
      cpu: 2048
    });

    // Add EFS volume to task definition
    taskDefinition.addVolume({
      name: 'gitlab-data',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED'
      }
    });

    // Add GitLab container
    const gitlabContainer = taskDefinition.addContainer('GitLabContainer', {
      image: ecs.ContainerImage.fromRegistry('gitlab/gitlab-ce:latest'),
      essential: true,
      portMappings: [
        { containerPort: 80 },    // HTTP
        { containerPort: 443 },   // HTTPS
        { containerPort: 22 }     // SSH
      ],
      environment: {
        'GITLAB_OMNIBUS_CONFIG': 'external_url "http://' + alb.loadBalancerDnsName + '";'
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'gitlab' })
    });

    // Mount EFS volume to container
    gitlabContainer.addMountPoints({
      sourceVolume: 'gitlab-data',
      containerPath: '/var/opt/gitlab',
      readOnly: false
    });

    // Create a Fargate service
    const gitlabService = new ecs.FargateService(this, 'GitLabService', {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      // Place the task in private subnets but enable public IP for initial setup
      // This ensures that the task can pull the GitLab image from Docker Hub
      assignPublicIp: true,
      securityGroups: [gitlabServiceSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    // Create target group for the service
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'GitLabTargetGroup', {
      vpc: vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        interval: Duration.seconds(60),
        timeout: Duration.seconds(30),
        healthyHttpCodes: '200-499', // GitLab might redirect before it's fully ready
        unhealthyThresholdCount: 5,
        healthyThresholdCount: 2
      },
      deregistrationDelay: Duration.seconds(30)
    });

    // Register service with target group
    gitlabService.attachToApplicationTargetGroup(targetGroup);

    // Add target group to ALB listener
    listener.addTargetGroups('GitLabTargetGroup', {
      targetGroups: [targetGroup]
    });

    // Output the ALB DNS name
    new cdk.CfnOutput(this, 'GitLabUrl', {
      value: 'http://' + alb.loadBalancerDnsName,
      description: 'The URL of the GitLab instance'
    });

    // Add tags to all resources for cost tracking and management
    Tags.of(this).add('Project', 'GitLabDeployment');
    Tags.of(this).add('Environment', 'Production');
    Tags.of(this).add('ManagedBy', 'CDK');
    Tags.of(this).add('Service', 'GitLab');
  }
}
