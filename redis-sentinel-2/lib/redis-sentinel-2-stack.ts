import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export class RedisSentinel2Stack extends Stack {
  private vpc: ec2.Vpc;
  private cluster: ecs.Cluster;
  private redisSecurityGroup: ec2.SecurityGroup;
  private sentinelSecurityGroup: ec2.SecurityGroup;
  private webSecurityGroup: ec2.SecurityGroup;
  private namespace: servicediscovery.PrivateDnsNamespace;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.createVpc();
    this.createEcsCluster();
    this.createServiceDiscovery();
    this.createSecurityGroups();
    this.createRedisServices();
    this.createSentinelServices();
    this.createWebUI();
  }

  private createVpc(): void {
    this.vpc = new ec2.Vpc(this, 'RedisSentinelVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });
  }

  private createEcsCluster(): void {
    this.cluster = new ecs.Cluster(this, 'RedisSentinelCluster', {
      vpc: this.vpc,
      containerInsights: true,
    });
  }

  private createServiceDiscovery(): void {
    this.namespace = new servicediscovery.PrivateDnsNamespace(this, 'RedisSentinelNamespace', {
      name: 'redis-sentinel.local',
      vpc: this.vpc,
    });
  }

  private createSecurityGroups(): void {
    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Redis instances',
      allowAllOutbound: true,
    });

    this.sentinelSecurityGroup = new ec2.SecurityGroup(this, 'SentinelSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Sentinel instances',
      allowAllOutbound: true,
    });

    this.redisSecurityGroup.addIngressRule(
      this.redisSecurityGroup,
      ec2.Port.tcp(6379),
      'Redis port from other Redis instances'
    );

    this.redisSecurityGroup.addIngressRule(
      this.sentinelSecurityGroup,
      ec2.Port.tcp(6379),
      'Redis port from Sentinel instances'
    );

    this.sentinelSecurityGroup.addIngressRule(
      this.sentinelSecurityGroup,
      ec2.Port.tcp(26379),
      'Sentinel port from other Sentinel instances'
    );

    this.sentinelSecurityGroup.addIngressRule(
      this.redisSecurityGroup,
      ec2.Port.tcp(26379),
      'Sentinel port from Redis instances'
    );

    this.webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for web UI',
      allowAllOutbound: true,
    });

    this.webSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP access from anywhere'
    );

    this.webSecurityGroup.addIngressRule(
      this.redisSecurityGroup,
      ec2.Port.tcp(6379),
      'Redis access from web UI'
    );

    this.webSecurityGroup.addIngressRule(
      this.sentinelSecurityGroup,
      ec2.Port.tcp(26379),
      'Sentinel access from web UI'
    );
  }

  private createRedisServices(): void {
    const redisTaskDefinition = new ecs.FargateTaskDefinition(this, 'RedisTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    redisTaskDefinition.addContainer('redis', {
      image: ecs.ContainerImage.fromRegistry('redis:7-alpine'),
      portMappings: [
        {
          containerPort: 6379,
          protocol: ecs.Protocol.TCP,
        },
      ],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'redis',
        logGroup: new logs.LogGroup(this, 'RedisLogGroup', {
          logGroupName: `/ecs/redis-sentinel-v2/redis-${this.node.addr}`,
        }),
      }),
      command: [
        'redis-server',
        '--protected-mode', 'no',
        '--bind', '0.0.0.0',
        '--port', '6379',
        '--save', '60', '1000',
        '--stop-writes-on-bgsave-error', 'no',
      ],
    });

    for (let i = 1; i <= 3; i++) {
      const service = new ecs.FargateService(this, `RedisService${i}`, {
        cluster: this.cluster,
        taskDefinition: redisTaskDefinition,
        desiredCount: 1,
        securityGroups: [this.redisSecurityGroup],
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        serviceName: `redis-${i}`,
        cloudMapOptions: {
          cloudMapNamespace: this.namespace,
          name: `redis-${i}`,
        },
      });
    }
  }

  private createSentinelServices(): void {
    const sentinelTaskDefinition = new ecs.FargateTaskDefinition(this, 'SentinelTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    sentinelTaskDefinition.addContainer('sentinel', {
      image: ecs.ContainerImage.fromRegistry('redis:7-alpine'),
      portMappings: [
        {
          containerPort: 26379,
          protocol: ecs.Protocol.TCP,
        },
      ],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'sentinel',
        logGroup: new logs.LogGroup(this, 'SentinelLogGroup', {
          logGroupName: `/ecs/redis-sentinel-v2/sentinel-${this.node.addr}`,
        }),
      }),
      command: [
        'sh', '-c', 
        'echo "port 26379" > /tmp/sentinel.conf && ' +
        'echo "bind 0.0.0.0" >> /tmp/sentinel.conf && ' +
        'echo "sentinel monitor mymaster redis-1.redis-sentinel.local 6379 2" >> /tmp/sentinel.conf && ' +
        'echo "sentinel down-after-milliseconds mymaster 30000" >> /tmp/sentinel.conf && ' +
        'echo "sentinel parallel-syncs mymaster 1" >> /tmp/sentinel.conf && ' +
        'echo "sentinel failover-timeout mymaster 180000" >> /tmp/sentinel.conf && ' +
        'redis-sentinel /tmp/sentinel.conf'
      ],
    });

    for (let i = 1; i <= 3; i++) {
      const service = new ecs.FargateService(this, `SentinelService${i}`, {
        cluster: this.cluster,
        taskDefinition: sentinelTaskDefinition,
        desiredCount: 1,
        securityGroups: [this.sentinelSecurityGroup],
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        serviceName: `sentinel-${i}`,
        cloudMapOptions: {
          cloudMapNamespace: this.namespace,
          name: `sentinel-${i}`,
        },
      });
    }
  }

  private createWebUI(): void {
    const webTaskDefinition = new ecs.FargateTaskDefinition(this, 'WebUITaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    webTaskDefinition.addContainer('web', {
      image: ecs.ContainerImage.fromRegistry('nginx:alpine'),
      portMappings: [
        {
          containerPort: 80,
          protocol: ecs.Protocol.TCP,
        },
      ],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'web-ui',
        logGroup: new logs.LogGroup(this, 'WebUILogGroup', {
          logGroupName: `/ecs/redis-sentinel-v2/web-${this.node.addr}`,
        }),
      }),
      environment: {
        'REDIS_HOSTS': 'redis-1,redis-2,redis-3',
        'SENTINEL_HOSTS': 'sentinel-1,sentinel-2,sentinel-3',
      },
    });

    const webService = new ecs.FargateService(this, 'WebUIService', {
      cluster: this.cluster,
      taskDefinition: webTaskDefinition,
      desiredCount: 1,
      securityGroups: [this.webSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      serviceName: 'redis-dashboard',
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'WebUILoadBalancer', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: this.webSecurityGroup,
    });

    const listener = alb.addListener('WebUIListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    listener.addTargets('WebUITargets', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [webService],
      healthCheck: {
        path: '/',
        interval: Duration.seconds(30),
      },
    });
  }
}
