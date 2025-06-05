import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';

export class SupersetStack1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC with 2 AZs, public subnets only
    const vpc = new ec2.Vpc(this, 'SupersetVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public-subnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'SupersetCluster', { vpc });

    // Task Role
    const taskRole = new iam.Role(this, 'SupersetTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Fargate Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'SupersetTaskDef', {
      memoryLimitMiB: 1024,
      cpu: 512,
      taskRole: taskRole,
    });

    // Container
    const container = taskDef.addContainer('SupersetContainer', {
      image: ecs.ContainerImage.fromRegistry('apache/superset'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'Superset' }),
    });

    container.addPortMappings({
      containerPort: 8088,
    });

    // Fargate Service
    const service = new ecs.FargateService(this, 'SupersetService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Security Group for ALB
    const albSg = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');

    // Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'SupersetALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    // Listener
    const listener = alb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    // Target Group
    listener.addTargets('SupersetTarget', {
      port: 8088,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: '200',
      },
    });

    // Output the ALB URL
    new cdk.CfnOutput(this, 'SupersetURL', {
      value: `http://${alb.loadBalancerDnsName}`,
    });
  }
}
