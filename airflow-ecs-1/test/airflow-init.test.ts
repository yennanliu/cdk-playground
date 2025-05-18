import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { AirflowInit } from '../lib/airflow-init';

describe('AirflowInit', () => {
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let cluster: ecs.Cluster;
  let taskDefinition: ecs.TaskDefinition;
  let logGroup: logs.LogGroup;
  let securityGroup: ec2.SecurityGroup;
  let airflowInit: AirflowInit;

  beforeAll(() => {
    stack = new cdk.Stack();
    
    // Create VPC
    vpc = new ec2.Vpc(stack, 'TestVpc', {
      maxAzs: 2,
    });
    
    // Create cluster
    cluster = new ecs.Cluster(stack, 'TestCluster', {
      vpc,
    });
    
    // Create security group
    securityGroup = new ec2.SecurityGroup(stack, 'TestSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    
    // Create a task role and execution role for the task definition
    const taskRole = new cdk.aws_iam.Role(stack, 'TaskRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    
    const executionRole = new cdk.aws_iam.Role(stack, 'ExecutionRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    
    // Create a task definition
    taskDefinition = new ecs.FargateTaskDefinition(stack, 'TaskDefinition', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole,
      executionRole,
    });
    
    // Create log group
    logGroup = new logs.LogGroup(stack, 'InitLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    
    // Create AirflowInit
    airflowInit = new AirflowInit({
      scope: stack,
      cluster,
      taskDefinition,
      dbEndpointAddress: 'db.example.com',
      dbEndpointPort: '5432',
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      logGroup,
    });
  });

  test('creates init container', () => {
    // Verify we have a task definition with an init container
    const containerDefs = (taskDefinition.node.defaultChild as any).resource.properties.containerDefinitions;
    expect(containerDefs).toBeDefined();
    
    // Check for init container
    const initContainer = containerDefs.find((c: any) => c.name === 'init');
    expect(initContainer).toBeDefined();
    expect(initContainer.command).toContain('bash');
    expect(initContainer.command).toContain('-c');
    expect(initContainer.command[2]).toContain('airflow db init');
    expect(initContainer.command[2]).toContain('airflow users create');
  });
  
  test('creates init service', () => {
    // Verify we have a service
    expect(airflowInit.initTask).toBeDefined();
    
    // Check the service properties
    const service = airflowInit.initTask;
    expect(service.cluster).toBe(cluster);
    // Verify the service is configured but don't check internal properties directly
  });
  
  test('configures auto scaling', () => {
    // Verify that the auto scaling properties are created
    const resources = stack.node.findAll().filter(resource => 
      resource.node.id.includes('RunInitTask') && 
      resource.node.id.includes('ScalingPolicy')
    );
    
    expect(resources.length).toBeGreaterThan(0);
  });
}); 