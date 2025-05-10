import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface KafkaCluster {
  name: string;
  bootstrapServers: string;
  schemaRegistry?: string;
  properties?: Record<string, string>;
}

export interface EcsKafkaUiStackProps extends cdk.StackProps {
  /**
   * Optional Kafka clusters to connect to
   */
  kafkaClusters?: KafkaCluster[];
  /**
   * Whether to enable dynamic configuration
   * @default true
   */
  dynamicConfigEnabled?: boolean;
  /**
   * The container image to use
   * @default provectuslabs/kafka-ui:latest
   */
  imageName?: string;
  /**
   * Desired count of tasks
   * @default 1
   */
  desiredCount?: number;
  /**
   * Memory limit for the container in MiB
   * @default 1024
   */
  memoryLimitMiB?: number;
  /**
   * CPU units for the container
   * @default 512
   */
  cpu?: number;
}

export class EcsKafkaUiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: EcsKafkaUiStackProps) {
    super(scope, id, props);

    // Set default values
    const {
      kafkaClusters = [],
      dynamicConfigEnabled = true,
      imageName = 'provectuslabs/kafka-ui:latest',
      desiredCount = 1,
      memoryLimitMiB = 1024,
      cpu = 512,
    } = props || {};

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'KafkaUiVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'KafkaUiCluster', {
      vpc: vpc,
      containerInsights: true,
    });

    // Prepare environment variables for Kafka UI
    const environment: Record<string, string> = {
      'DYNAMIC_CONFIG_ENABLED': dynamicConfigEnabled.toString(),
    };

    // Add environment variables for Kafka clusters if provided
    kafkaClusters.forEach((kafkaCluster, index) => {
      environment[`KAFKA_CLUSTERS_${index}_NAME`] = kafkaCluster.name;
      environment[`KAFKA_CLUSTERS_${index}_BOOTSTRAPSERVERS`] = kafkaCluster.bootstrapServers;
      
      if (kafkaCluster.schemaRegistry) {
        environment[`KAFKA_CLUSTERS_${index}_SCHEMAREGISTRY`] = kafkaCluster.schemaRegistry;
      }
      
      // Add any custom properties
      if (kafkaCluster.properties) {
        Object.entries(kafkaCluster.properties).forEach(([key, value]) => {
          environment[`KAFKA_CLUSTERS_${index}_PROPERTIES_${key.toUpperCase()}`] = value;
        });
      }
    });

    // Create a Fargate service with an application load balancer
    const kafkaUiService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'KafkaUiService', {
      cluster: cluster,
      memoryLimitMiB: memoryLimitMiB,
      cpu: cpu,
      desiredCount: desiredCount,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(imageName),
        containerPort: 8080,
        environment: environment,
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'kafka-ui',
          logRetention: logs.RetentionDays.ONE_WEEK,
        }),
      },
      publicLoadBalancer: true,
    });

    // Adjust health check path for the target group
    kafkaUiService.targetGroup.configureHealthCheck({
      path: '/actuator/health',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Add security group rule to allow inbound traffic on port 8080
    kafkaUiService.service.connections.allowFromAnyIpv4(ec2.Port.tcp(8080), 'Allow inbound HTTP traffic');

    // Output the service URL
    new cdk.CfnOutput(this, 'KafkaUiServiceURL', {
      value: kafkaUiService.loadBalancer.loadBalancerDnsName,
      description: 'URL for Kafka UI service',
    });
  }
}
