import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as path from "path";

/**
 * The provided CDK stack launches 3 Redis instances, each running both:
  •	A Redis Server, and
  •	A Redis Sentinel process
  - All 3 tasks are deployed as replicas in a Fargate Service, effectively forming a minimal Redis Sentinel cluster.
  - Includes a TypeScript Lambda function with API Gateway to test the Redis Sentinel setup.
 */
export class RedisSentinel1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC
    const vpc = new ec2.Vpc(this, "RedisVpc", {
      maxAzs: 2,
    });

    // 2. ECS Cluster with Service Discovery Namespace
    const cluster = new ecs.Cluster(this, "RedisCluster", {
      vpc,
      defaultCloudMapNamespace: {
        name: "redis.local",
      },
    });

    // 3. Security Group for Redis
    const redisSg = new ec2.SecurityGroup(this, "RedisSg", {
      vpc,
      description: "Allow Redis and Sentinel traffic",
      allowAllOutbound: true,
    });

    redisSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(6379)); // Redis
    redisSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(26379)); // Sentinel

    // 4. Security Group for Lambda
    const lambdaSg = new ec2.SecurityGroup(this, "LambdaSg", {
      vpc,
      description: "Security group for Lambda function",
      allowAllOutbound: true,
    });

    // Allow Lambda to connect to Redis
    redisSg.addIngressRule(lambdaSg, ec2.Port.tcp(6379));
    redisSg.addIngressRule(lambdaSg, ec2.Port.tcp(26379));

    // 5. Redis Master Task Definition
    const masterTaskDef = new ecs.FargateTaskDefinition(this, "RedisMasterTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    const masterContainer = masterTaskDef.addContainer("redis", {
      image: ecs.ContainerImage.fromRegistry("bitnami/redis-sentinel:latest"),
      environment: {
        REDIS_REPLICATION_MODE: "master",
        REDIS_PORT_NUMBER: "6379",
        REDIS_MASTER_HOST: "localhost",
        REDIS_MASTER_PORT_NUMBER: "6379",
        REDIS_MASTER_NAME: "mymaster",
        REDIS_SENTINEL_DOWN_AFTER_MILLISECONDS: "5000",
        REDIS_SENTINEL_FAILOVER_TIMEOUT: "60000",
        REDIS_SENTINEL_QUORUM: "2",
      },
      portMappings: [{ containerPort: 6379 }, { containerPort: 26379 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "redis-master",
      }),
    });

    // 6. Master Fargate Service with Service Discovery
    const masterService = new ecs.FargateService(this, "RedisMasterService", {
      cluster,
      taskDefinition: masterTaskDef,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [redisSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        name: "master",
        dnsTtl: cdk.Duration.seconds(60),
        container: masterContainer,
        containerPort: 6379,
      },
    });

    // 7. Redis Replica Task Definition
    const replicaTaskDef = new ecs.FargateTaskDefinition(this, "RedisReplicaTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    const replicaContainer = replicaTaskDef.addContainer("redis", {
      image: ecs.ContainerImage.fromRegistry("bitnami/redis-sentinel:latest"),
      environment: {
        REDIS_REPLICATION_MODE: "slave",
        REDIS_MASTER_HOST: "master.redis.local",
        REDIS_MASTER_PORT_NUMBER: "6379",
        REDIS_MASTER_NAME: "mymaster",
        REDIS_SENTINEL_DOWN_AFTER_MILLISECONDS: "5000",
        REDIS_SENTINEL_FAILOVER_TIMEOUT: "60000",
        REDIS_SENTINEL_QUORUM: "2",
      },
      portMappings: [{ containerPort: 6379 }, { containerPort: 26379 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "redis-replica",
      }),
    });

    // 8. Replica Fargate Service
    const replicaService = new ecs.FargateService(this, "RedisReplicaService", {
      cluster,
      taskDefinition: replicaTaskDef,
      desiredCount: 2,
      assignPublicIp: false,
      securityGroups: [redisSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        name: "replica",
        dnsTtl: cdk.Duration.seconds(60),
        container: replicaContainer,
        containerPort: 6379,
      },
    });

    // 7. Lambda function to test Redis Sentinel (using pre-compiled JS)
    const testLambda = new lambda.Function(this, "RedisTestLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      //code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/dist")),
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda")),
      vpc: vpc,
      securityGroups: [lambdaSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        REDIS_MASTER_NAME: "mymaster",
      },
    });

    // Add permissions for CloudWatch Logs
    testLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: ['*']
    }));

    // Add permissions for VPC access
    testLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:CreateNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DeleteNetworkInterface',
        'ec2:AttachNetworkInterface',
        'ec2:DetachNetworkInterface'
      ],
      resources: ['*']
    }));

    // Add permissions for ECS and EC2 service discovery
    testLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ecs:ListTasks',
        'ecs:DescribeTasks',
        'ecs:ListClusters',
        'ecs:DescribeClusters',
        'ec2:DescribeNetworkInterfaces'
      ],
      resources: ['*']
    }));

    // 8. API Gateway
    const api = new apigateway.RestApi(this, "RedisTestApi", {
      restApiName: "Redis Sentinel Test API",
      description: "API to test Redis Sentinel cluster",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const testIntegration = new apigateway.LambdaIntegration(testLambda);

    const testResource = api.root.addResource("test");
    testResource.addMethod("GET", testIntegration);
    testResource.addMethod("POST", testIntegration);

    // 9. Outputs
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: api.url,
      description: "API Gateway endpoint for Redis testing",
    });

    new cdk.CfnOutput(this, "TestEndpoints", {
      value: `GET ${api.url}test?action=[discover|test|redis-ops|sentinel|info]`,
      description: "Test endpoints for Redis Sentinel - try different actions",
    });

    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
      description: "ECS Cluster name",
    });

    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: testLambda.functionName,
      description: "Lambda function name for Redis testing",
    });
  }
}
