import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { DatabaseStack } from './database-stack';
import { BaseStack } from './base-stack';

export interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dbStack: DatabaseStack;
  baseStack: BaseStack;
}

export class EcsStack extends cdk.Stack {
  public readonly clusters: ecs.Cluster[];
  public readonly services: ecs.FargateService[];
  public readonly ecsSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id);

    this.clusters = this.createClusters(props.vpc);
    const taskDefinition = this.createTaskDefinition(props);
    this.ecsSecurityGroup = this.createSecurityGroup(props.vpc);
    
    // Configure security group rules
    this.configureSecurityGroups(props.dbStack, this.ecsSecurityGroup);
    
    this.services = this.createServices(this.clusters, taskDefinition, this.ecsSecurityGroup, props.vpc);
  }

  private createClusters(vpc: ec2.Vpc): ecs.Cluster[] {
    return ['SupersetCluster', 'SupersetCluster-2'].map(name => 
      new ecs.Cluster(this, name, { vpc })
    );
  }

  private createTaskDefinition(props: EcsStackProps): ecs.FargateTaskDefinition {
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'SupersetTaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    // Grant permissions
    props.baseStack.dbSecret.grantRead(taskDefinition.taskRole);
    props.baseStack.supersetSecret.grantRead(taskDefinition.taskRole);
    props.baseStack.reportDbSecret.grantRead(taskDefinition.taskRole);

    this.addContainer(taskDefinition, props);
    return taskDefinition;
  }

  private addContainer(taskDefinition: ecs.FargateTaskDefinition, props: EcsStackProps) {
    const container = taskDefinition.addContainer('SupersetContainer', {
      image: ecs.ContainerImage.fromRegistry('apache/superset:latest'),
      logging: this.createLogDriver(),
      environment: this.getContainerEnvironment(props),
      secrets: this.getContainerSecrets(props),
      command: this.getContainerCommand(),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8088/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(180),
      },
    });

    container.addPortMappings({
      containerPort: 8088,
      protocol: ecs.Protocol.TCP,
    });
  }

  private createLogDriver(): ecs.LogDriver {
    return ecs.LogDrivers.awsLogs({
      streamPrefix: 'superset',
      logGroup: new logs.LogGroup(this, 'SupersetLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
      }),
    });
  }

  private getContainerEnvironment(props: EcsStackProps): { [key: string]: string } {
    return {
      DB_HOST: props.dbStack.database.instanceEndpoint.hostname,
      DB_PORT: props.dbStack.database.instanceEndpoint.port.toString(),
      DB_NAME: 'superset',
      REPORTING_DB_HOST: props.dbStack.reportDatabase.instanceEndpoint.hostname,
      REPORTING_DB_PORT: props.dbStack.reportDatabase.instanceEndpoint.port.toString(),
      REPORTING_DB_NAME: 'reporting',
    };
  }

  private getContainerSecrets(props: EcsStackProps): { [key: string]: ecs.Secret } {
    return {
      DB_USER: ecs.Secret.fromSecretsManager(props.baseStack.dbSecret, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(props.baseStack.dbSecret, 'password'),
      SUPERSET_SECRET_KEY: ecs.Secret.fromSecretsManager(props.baseStack.supersetSecret, 'secret_key'),
      REPORTING_DB_USER: ecs.Secret.fromSecretsManager(props.baseStack.reportDbSecret, 'username'),
      REPORTING_DB_PASSWORD: ecs.Secret.fromSecretsManager(props.baseStack.reportDbSecret, 'password'),
    };
  }

  private getContainerCommand(): string[] {
    return [
      '/bin/bash',
      '-c',
      `echo "Installing required packages..." && \
       pip install psycopg2-binary && \
       export SQLALCHEMY_DATABASE_URI="postgresql://\${DB_USER}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_NAME}" && \
       export REPORTING_DATABASE_URI="postgresql://\${REPORTING_DB_USER}:\${REPORTING_DB_PASSWORD}@\${REPORTING_DB_HOST}:\${REPORTING_DB_PORT}/\${REPORTING_DB_NAME}" && \
       echo "Waiting for database connection..." && \
       sleep 30 && \
       echo "Initializing Superset database..." && \
       superset db upgrade && \
       echo "Creating admin user..." && \
       superset fab create-admin --username admin --firstname Superset --lastname Admin --email admin@superset.com --password admin || echo "Admin user may already exist" && \
       echo "Initializing Superset..." && \
       superset init && \
       echo "Configuring reporting database..." && \
       echo "Starting Superset server..." && \
       superset run -h 0.0.0.0 -p 8088`
    ];
  }

  private createSecurityGroup(vpc: ec2.Vpc): ec2.SecurityGroup {
    return new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Security group for ECS Superset service',
    });
  }

  private configureSecurityGroups(dbStack: DatabaseStack, ecsSecurityGroup: ec2.SecurityGroup): void {
    dbStack.dbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS to connect to PostgreSQL'
    );

    dbStack.reportDbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS to connect to PostgreSQL reporting database'
    );
  }

  private createServices(
    clusters: ecs.Cluster[],
    taskDefinition: ecs.FargateTaskDefinition,
    securityGroup: ec2.SecurityGroup,
    vpc: ec2.Vpc
  ): ecs.FargateService[] {
    return clusters.map((cluster, index) => 
      new ecs.FargateService(this, `SupersetService${index === 0 ? '' : '-2'}`, {
        cluster,
        taskDefinition,
        desiredCount: 1,
        assignPublicIp: false,
        securityGroups: [securityGroup],
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
      })
    );
  }
}
