import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseStack } from './base-stack';
import { DatabaseStack } from './database-stack';
import { EcsStack } from './ecs-stack';
import { LoadBalancerStack } from './load-balancer-stack';

export class SupersetStack3Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create base stack with VPC and secrets
    const baseStack = new BaseStack(this, 'SupersetBaseStack', {
      stackName: 'superset-base'
    });

    // Create database stack
    const dbStack = new DatabaseStack(this, 'SupersetDatabaseStack', {
      vpc: baseStack.vpc,
      dbSecret: baseStack.dbSecret,
      reportDbSecret: baseStack.reportDbSecret,
    });

    // Create ECS stack
    const ecsStack = new EcsStack(this, 'SupersetEcsStack', {
      vpc: baseStack.vpc,
      dbStack: dbStack,
      baseStack: baseStack,
    });

    // Create load balancer stack
    const lbStack = new LoadBalancerStack(this, 'SupersetLoadBalancerStack', {
      vpc: baseStack.vpc,
      services: ecsStack.services,
      ecsSecurityGroup: ecsStack.ecsSecurityGroup,
    });

    // Outputs
    new CfnOutput(this, 'LoadBalancerDNS', {
      value: lbStack.albDnsName,
      description: 'DNS name of the Load Balancer',
    });

    new CfnOutput(this, 'SupersetLoginURL', {
      value: `http://${lbStack.albDnsName}`,
      description: 'Superset login URL',
    });

    new CfnOutput(this, 'DatabaseEndpoint', {
      value: dbStack.database.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
    });

    new CfnOutput(this, 'ReportingDbEndpoint', {
      value: dbStack.reportDatabase.instanceEndpoint.hostname,
      description: 'PostgreSQL reporting database endpoint',
    });

    new CfnOutput(this, 'ReportingDbPort', {
      value: dbStack.reportDatabase.instanceEndpoint.port.toString(),
      description: 'PostgreSQL reporting database port',
    });

    new CfnOutput(this, 'ReportingDbSecretArn', {
      value: baseStack.reportDbSecret.secretArn,
      description: 'PostgreSQL reporting database credentials secret ARN',
    });
  }
}
