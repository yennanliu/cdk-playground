import { Duration, Stack, StackProps } from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";

/**
 * The provided CDK stack launches 3 Redis instances, each running both:
	•	A Redis Server, and
	•	A Redis Sentinel process
  - All 3 tasks are deployed as replicas in a Fargate Service, effectively forming a minimal Redis Sentinel cluster.
 */
export class RedisSentinel1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC
    const vpc = new ec2.Vpc(this, "RedisVpc", {
      maxAzs: 2,
    });

    // 2. ECS Cluster
    const cluster = new ecs.Cluster(this, "RedisCluster", {
      vpc,
    });

    // 3. Security Group
    const redisSg = new ec2.SecurityGroup(this, "RedisSg", {
      vpc,
      description: "Allow Redis and Sentinel traffic",
      allowAllOutbound: true,
    });

    redisSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(6379)); // Redis
    redisSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(26379)); // Sentinel

    // 4. Redis & Sentinel Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, "RedisTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    taskDef.addContainer("redis", {
      image: ecs.ContainerImage.fromRegistry("bitnami/redis-sentinel:latest"),
      environment: {
        REDIS_MASTER_NAME: "mymaster",
        REDIS_MASTER_HOST: "redis-master",
        REDIS_MASTER_PORT_NUMBER: "6379",
        REDIS_SENTINEL_DOWN_AFTER_MILLISECONDS: "5000",
        REDIS_SENTINEL_FAILOVER_TIMEOUT: "60000",
        REDIS_SENTINEL_QUORUM: "2",
      },
      portMappings: [{ containerPort: 6379 }, { containerPort: 26379 }],
    });

    // 5. Fargate Service
    new ecs.FargateService(this, "RedisFargateService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 3,
      assignPublicIp: true,
      securityGroups: [redisSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
  }
}

// export class RedisSentinel1Stack extends Stack {
//   constructor(scope: Construct, id: string, props?: StackProps) {
//     super(scope, id, props);

//     const queue = new sqs.Queue(this, 'RedisSentinel1Queue', {
//       visibilityTimeout: Duration.seconds(300)
//     });

//     const topic = new sns.Topic(this, 'RedisSentinel1Topic');

//     topic.addSubscription(new subs.SqsSubscription(queue));
//   }
// }
