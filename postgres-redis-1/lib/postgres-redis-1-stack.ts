import { Duration, Stack, StackProps, CfnOutput, SecretValue } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';

export class PostgresRedis1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create VPC
    const vpc = new ec2.Vpc(this, 'MyVPC', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        }
      ],
    });

    // Security group for PostgreSQL
    const postgresSecurityGroup = new ec2.SecurityGroup(this, 'PostgresSecurityGroup', {
      vpc,
      description: 'Security group for PostgreSQL',
      allowAllOutbound: true,
    });
    postgresSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'Allow public access to PostgreSQL'
    );

    // Create PostgreSQL instance
    const postgres = new rds.DatabaseInstance(this, 'PostgresInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromPassword('postgres', SecretValue.unsafePlainText('postgres')),
      securityGroups: [postgresSecurityGroup],
      publiclyAccessible: true,
    });

    // Security group for Redis
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security group for Redis',
      allowAllOutbound: true,
    });
    redisSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(6379),
      'Allow public access to Redis'
    );

    // Create Redis subnet group
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: vpc.publicSubnets.map(subnet => subnet.subnetId),
    });

    // Create Redis cluster
    const redis = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      engine: 'redis',
      cacheNodeType: 'cache.t3.micro',
      numCacheNodes: 1,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.ref,
      azMode: 'single-az',
      engineVersion: '7.0',
      port: 6379,
    });

    // Output the endpoints
    new CfnOutput(this, 'PostgresEndpoint', {
      value: postgres.instanceEndpoint.hostname,
      description: 'PostgreSQL endpoint',
    });

    new CfnOutput(this, 'RedisEndpoint', {
      value: redis.attrRedisEndpointAddress,
      description: 'Redis endpoint',
    });

    new CfnOutput(this, 'RedisPort', {
      value: redis.attrRedisEndpointPort,
      description: 'Redis port',
    });
  }
}
