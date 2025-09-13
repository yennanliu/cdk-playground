import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { BaseStack } from './base-stack';
import { DatabaseStack } from './database-stack';
import { EcsStack } from './ecs-stack';
import { LoadBalancerStack } from './load-balancer-stack';

export class SupersetStack3Stack extends Stack {
  private createSecrets() {
    const dbSecret = new secretsmanager.Secret(this, 'SupersetDbSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
      },
    });

    const reportDbSecret = new secretsmanager.Secret(this, 'ReportDbSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
      },
    });

    const supersetSecret = new secretsmanager.Secret(this, 'SupersetSecretKey', {
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'secret_key',
        excludeCharacters: '"@/\\\'',
      },
    });

    return { dbSecret, reportDbSecret, supersetSecret };
  }

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // First create all the secrets needed
    const { dbSecret, reportDbSecret, supersetSecret } = this.createSecrets();

    // Then create the base stack with VPC
    const baseStack = new BaseStack(this, 'SupersetBaseStack', {
      stackName: 'superset-base',
      dbSecret,
      reportDbSecret,
      supersetSecret
    });

    // Create database stack after base stack
    const dbStack = new DatabaseStack(this, 'SupersetDatabaseStack', {
      vpc: baseStack.vpc,
      dbSecret,
      reportDbSecret,
    });

    // Create ECS stack
    const ecsStack = new EcsStack(this, 'SupersetEcsStack', {
      vpc: baseStack.vpc,
      dbSecurityGroup: dbStack.dbSecurityGroup,
      reportDbSecurityGroup: dbStack.reportDbSecurityGroup,
      dbEndpoint: dbStack.database.instanceEndpoint,
      reportDbEndpoint: dbStack.reportDatabase.instanceEndpoint,
      dbSecret: baseStack.dbSecret,
      reportDbSecret: baseStack.reportDbSecret,
      supersetSecret: baseStack.supersetSecret,
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
