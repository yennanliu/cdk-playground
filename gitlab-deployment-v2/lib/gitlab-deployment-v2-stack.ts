import { Stack, StackProps, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

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

    // Security group for the EFS file system
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

    // Create an EFS file system for GitLab persistent storage
    const fileSystem = new efs.FileSystem(this, 'GitLabEfsFileSystem', {
      vpc: vpc,
      securityGroup: efsSecurityGroup,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      encrypted: true,
      removalPolicy: RemovalPolicy.RETAIN,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    // Create an access point for GitLab data with root access
    // We'll create directory structure and set permissions in the container
    const accessPoint = new efs.AccessPoint(this, 'GitLabEfsAccessPoint', {
      fileSystem: fileSystem,
      path: '/',
      createAcl: {
        ownerGid: '0',  // root group
        ownerUid: '0',  // root user
        permissions: '755'
      },
      posixUser: {
        gid: '0',
        uid: '0'
      }
    });

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

    // Grant ECS task execution role permissions to access EFS
    const executionRole = new iam.Role(this, 'GitLabTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    });

    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:ClientWrite',
        'elasticfilesystem:DescribeMountTargets'
      ],
      resources: [fileSystem.fileSystemArn]
    }));

    // Create a Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'GitLabTaskDef', {
      memoryLimitMiB: 4096,
      cpu: 2048,
      executionRole: executionRole,
      taskRole: executionRole
    });

    // Add EFS volume to task definition using the access point
    taskDefinition.addVolume({
      name: 'gitlab-data',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED'
        }
      }
    });

    // Add initialization container to set up permissions
    const initContainer = taskDefinition.addContainer('InitContainer', {
      image: ecs.ContainerImage.fromRegistry('amazonlinux:2'),
      essential: false,
      command: [
        'sh', '-c',
        'mkdir -p /var/opt/gitlab/git-data && ' +
        'mkdir -p /var/opt/gitlab/.ssh && ' +
        'mkdir -p /var/opt/gitlab/gitlab-rails && ' +
        'mkdir -p /var/opt/gitlab/gitlab-ci && ' +
        'mkdir -p /var/opt/gitlab/postgresql && ' +
        'mkdir -p /var/opt/gitlab/redis && ' +
        'mkdir -p /var/opt/gitlab/nginx && ' +
        'mkdir -p /var/opt/gitlab/prometheus && ' +
        'chown -R 998:998 /var/opt/gitlab && ' +
        'chmod -R 775 /var/opt/gitlab'
      ],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'gitlab-init' })
    });

    // Mount the EFS volume to the init container
    initContainer.addMountPoints({
      sourceVolume: 'gitlab-data',
      containerPath: '/var/opt/gitlab',
      readOnly: false
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
        'GITLAB_OMNIBUS_CONFIG': 'external_url "http://' + alb.loadBalancerDnsName + '";' +
                              'gitlab_rails[\'gitlab_shell_ssh_port\'] = 22;' +
                              'git_data_dirs({"default" => { "path" => "/var/opt/gitlab/git-data"} });' +
                              'unicorn[\'worker_processes\'] = 2;' +
                              'postgresql[\'shared_buffers\'] = "256MB";' + 
                              'prometheus_monitoring[\'enable\'] = false;'
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'gitlab' })
    });

    // Set container dependencies - ensure init container runs first
    gitlabContainer.addContainerDependencies({
      container: initContainer,
      condition: ecs.ContainerDependencyCondition.COMPLETE
    });

    // Grant full permission to the container to modify EFS data
    gitlabContainer.addUlimits({
      name: ecs.UlimitName.NOFILE,
      softLimit: 65535,
      hardLimit: 65535
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
      assignPublicIp: true,  // Required to pull Docker images
      securityGroups: [gitlabServiceSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,  // Latest platform version for better EFS support
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE',
          weight: 1
        }
      ]
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

    // Output the EFS file system ID for reference
    new cdk.CfnOutput(this, 'EfsFileSystemId', {
      value: fileSystem.fileSystemId,
      description: 'The ID of the EFS file system used for GitLab data'
    });

    // Add tags to all resources for cost tracking and management
    Tags.of(this).add('Project', 'GitLabDeployment');
    Tags.of(this).add('Environment', 'Production');
    Tags.of(this).add('ManagedBy', 'CDK');
    Tags.of(this).add('Service', 'GitLab');
  }
}
