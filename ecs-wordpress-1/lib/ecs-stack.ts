import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class EcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'WordPressCluster', {
      vpc: props.vpc,
    });

    // Define a Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WordPressTaskDef');

    // Add a container to the task definition
    const container = taskDefinition.addContainer('WordPressContainer', {
      image: ecs.ContainerImage.fromRegistry('wordpress:latest'),
      memoryLimitMiB: 512,
      cpu: 256,
      environment: {
        WORDPRESS_DB_HOST: 'REPLACE_WITH_RDS_ENDPOINT',
        WORDPRESS_DB_USER: 'REPLACE_WITH_DB_USER',
        WORDPRESS_DB_PASSWORD: 'REPLACE_WITH_DB_PASSWORD',
        WORDPRESS_DB_NAME: 'wordpress',
      },
    });

    container.addPortMappings({
      containerPort: 80,
    });

    // Create a Fargate service
    const service = new ecs.FargateService(this, 'WordPressService', {
      cluster,
      taskDefinition,
    });

    // Create an Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'WordPressALB', {
      vpc: props.vpc,
      internetFacing: true,
    });

    // Add a listener to the ALB
    const listener = alb.addListener('Listener', {
      port: 80,
      open: true,
    });

    // Attach the service to the ALB
    listener.addTargets('WordPressTarget', {
      port: 80,
      targets: [service],
    });
  }
}