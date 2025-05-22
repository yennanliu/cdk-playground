import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class MazeCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. Create a VPC
    const vpc = new ec2.Vpc(this, 'MazeVpc', {
      maxAzs: 2,
      natGateways: 1 // Add NAT gateway for RDS access
    });

    // 2. Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'MazeEcsCluster', {
      vpc
    });

    // 3. Create RDS MySQL instance
    const dbInstance = new rds.DatabaseInstance(this, 'MazeDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0
      }),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      databaseName: 'maze_db',
      removalPolicy: RemovalPolicy.SNAPSHOT,
      backupRetention: Duration.days(3),
      credentials: rds.Credentials.fromGeneratedSecret('maze_admin'),
      securityGroups: [
        new ec2.SecurityGroup(this, 'MazeDbSecurityGroup', {
          vpc,
          description: 'Security group for Maze RDS instance',
          allowAllOutbound: true
        })
      ]
    });

    // Allow ECS tasks to access RDS
    dbInstance.connections.allowFrom(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(3306),
      'Allow ECS tasks to access RDS'
    );

    // 4. Define a Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MazeTaskDef', {
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX
      },
      memoryLimitMiB: 1024,
      cpu: 512
    });

    // 5. Add container exposing port 8080
    const container = taskDefinition.addContainer('MazeContainer', {
      image: ecs.ContainerImage.fromRegistry('yennanliu/maze-app:dev-1'),
      memoryLimitMiB: 512,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'MazeApp' }),
      environment: {
        'SPRING_DATASOURCE_URL': `jdbc:mysql://${dbInstance.instanceEndpoint.hostname}:3306/maze_db`,
        'SPRING_DATASOURCE_USERNAME': 'maze_admin',
        'SPRING_JPA_HIBERNATE_DDL_AUTO': 'update',
        'SPRING_JPA_SHOW_SQL': 'true',
        'SPRING_JPA_PROPERTIES_HIBERNATE_DIALECT': 'org.hibernate.dialect.MySQL8Dialect',
        'JAVA_TOOL_OPTIONS': '-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0'
      },
      secrets: {
        'SPRING_DATASOURCE_PASSWORD': ecs.Secret.fromSecretsManager(dbInstance.secret!, 'password')
      },
      essential: true
    });

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP
    });

    // 6. Create ECS service
    const service = new ecs.FargateService(this, 'MazeService', {
      cluster,
      taskDefinition,
      assignPublicIp: false, // Use private subnet with NAT gateway
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    // 7. Create public-facing ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'MazeALB', {
      vpc,
      internetFacing: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      }
    });

    // 8. Add HTTP listener (port 80)
    const listener = alb.addListener('MazeListener', {
      port: 80,
      open: true
    });

    // 9. Forward ALB traffic to ECS container on port 8080
    listener.addTargets('MazeEcsTargets', {
      port: 8080,
      targets: [service],
      healthCheck: {
        port: '8080',
        path: '/',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2
      }
    });

    // 10. Optional: S3 bucket
    // const bucket = new s3.Bucket(this, 'MazeBucket', {
    //   versioned: true
    // });

    // Outputs
    new CfnOutput(this, 'MazeAppUrl', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'URL of the Maze App'
    });

    new CfnOutput(this, 'DatabaseEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
      description: 'RDS MySQL endpoint'
    });

    new CfnOutput(this, 'DatabaseSecretArn', {
      value: dbInstance.secret!.secretArn,
      description: 'RDS MySQL credentials secret ARN'
    });
  }
}