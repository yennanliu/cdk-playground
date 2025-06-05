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
    // const container = taskDef.addContainer('SupersetContainer', {
    //   image: ecs.ContainerImage.fromRegistry('apache/superset'),
    //   logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'Superset' }),
    //   environment: {
    //     'SUPERSET_SECRET_KEY': 'WRdrx3kRkwRBIG3VPtfhBr8ePmx1QFoAe9RceXBZ6IrAt27SFPlYvvBjM9aX',
    //     'ADMIN_USERNAME': 'admin',
    //     'ADMIN_PASSWORD': 'admin',
    //     'ADMIN_EMAIL': 'admin@superset.com',
    //     'ADMIN_FIRSTNAME': 'admin',
    //     'ADMIN_LASTNAME': 'admin',
    //   },
    // });

    // TODO: fix setup default login user, pwd
    const container = taskDef.addContainer('SupersetContainer', {
      image: ecs.ContainerImage.fromRegistry('apache/superset'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'Superset' }),
      environment: {
        'SUPERSET_SECRET_KEY': 'WRdrx3kRkwRBIG3VPtfhBr8ePmx1QFoAe9RceXBZ6IrAt27SFPlYvvBjM9aX',
        'ADMIN_USERNAME': 'admin',
        'ADMIN_PASSWORD': 'admin',
        'ADMIN_EMAIL': 'admin@superset.com',
        'ADMIN_FIRSTNAME': 'admin',
        'ADMIN_LASTNAME': 'admin',
      },
      command: [
        'sh',
        '-c',
        [
          'superset db upgrade',
          'superset fab create-admin --username $ADMIN_USERNAME --firstname $ADMIN_FIRSTNAME --lastname $ADMIN_LASTNAME --email $ADMIN_EMAIL --password $ADMIN_PASSWORD || true',
          'superset init',
          // 'superset run -h 0.0.0.0 -p 8088 --with-threads --reload --debugger'
        ].join(' && ')
      ]
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

    listener.addTargets('SupersetTarget', {
      port: 8088,
      protocol: elbv2.ApplicationProtocol.HTTP, // 👈 ADD THIS
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyHttpCodes: '200',
      },
    });


    // Output the ALB URL
    new cdk.CfnOutput(this, 'SupersetURL', {
      value: `http://${alb.loadBalancerDnsName}`,
    });
  }
}
