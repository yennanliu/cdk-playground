import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class RedisSentinel2Stack extends Stack {
  private vpc: ec2.Vpc;
  private cluster: ecs.Cluster;
  private redisSecurityGroup: ec2.SecurityGroup;
  private sentinelSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.createVpc();
    this.createEcsCluster();
    this.createSecurityGroups();
    this.createRedisServices();
    this.createSentinelServices();
  }

  private createVpc(): void {
    this.vpc = new ec2.Vpc(this, 'RedisSentinelVpc', {
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
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
          logGroupName: `/ecs/redis-sentinel-v2/redis-${Date.now()}`,
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
        desiredCount: 2,
        securityGroups: [this.redisSecurityGroup],
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        serviceName: `redis-${i}`,
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
          logGroupName: `/ecs/redis-sentinel-v2/sentinel-${Date.now()}`,
        }),
      }),
      command: [
        'sh', '-c', 
        'echo "port 26379" > /tmp/sentinel.conf && ' +
        'echo "sentinel monitor mymaster 127.0.0.1 6379 2" >> /tmp/sentinel.conf && ' +
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
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        serviceName: `sentinel-${i}`,
      });
    }
  }
}
