import { Stack, StackProps, CfnOutput, SecretValue, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { CfnSubnetGroup, CfnCacheCluster } from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';

export class JPostgreRedisEcsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Use the default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });

    // Create security group for PostgreSQL
    const postgresqlSG = new ec2.SecurityGroup(this, 'PostgreSQLSecurityGroup', {
      vpc,
      description: 'Allow all inbound traffic to PostgreSQL',
      allowAllOutbound: true,
    });
    postgresqlSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from anywhere'
    );

    // Create RDS PostgreSQL instance
    const postgresql = new rds.DatabaseInstance(this, 'PostgreSQLInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromPassword('postgre', SecretValue.unsafePlainText('postgre')),
      publiclyAccessible: true,
      securityGroups: [postgresqlSG],
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 30,
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Create security group for Redis
    const redisSG = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Allow all inbound traffic to Redis',
      allowAllOutbound: true,
    });
    redisSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(6379),
      'Allow Redis access from anywhere'
    );

    // Create Redis subnet group
    const redisSubnetGroup = new CfnSubnetGroup(this, 'RedisSubnetGroup', {
      subnetIds: vpc.publicSubnets.map(subnet => subnet.subnetId),
      description: 'Subnet group for Redis cluster',
    });

    // Create Redis cluster
    const redis = new CfnCacheCluster(this, 'RedisCluster', {
      engine: 'redis',
      cacheNodeType: 'cache.t3.micro',
      numCacheNodes: 1,
      vpcSecurityGroupIds: [redisSG.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.ref,
    });

    // Create ECR repository
    const repository = new ecr.Repository(this, 'DockerRepository', {
      repositoryName: 'my-docker-repo',
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteImages: true,
    });

    // Output the connection information
    new CfnOutput(this, 'PostgreSQLEndpoint', {
      value: postgresql.instanceEndpoint.hostname,
      description: 'PostgreSQL endpoint',
    });

    new CfnOutput(this, 'RedisEndpoint', {
      value: redis.attrRedisEndpointAddress,
      description: 'Redis endpoint',
    });

    new CfnOutput(this, 'ECRRepositoryURI', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI',
    });
  }
}
