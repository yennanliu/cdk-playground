import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { AirflowContainers } from '../lib/airflow-containers';

describe('AirflowContainers', () => {
  let stack: cdk.Stack;
  let taskDefinition: ecs.TaskDefinition;
  let webserverLogGroup: logs.LogGroup;
  let schedulerLogGroup: logs.LogGroup;
  let workerLogGroup: logs.LogGroup;
  let triggerLogGroup: logs.LogGroup;
  let airflowContainers: AirflowContainers;

  beforeAll(() => {
    stack = new cdk.Stack();
    
    // Create a task role and execution role for the task definition
    const taskRole = new cdk.aws_iam.Role(stack, 'TaskRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    
    const executionRole = new cdk.aws_iam.Role(stack, 'ExecutionRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    
    // Create a task definition
    taskDefinition = new ecs.FargateTaskDefinition(stack, 'TaskDefinition', {
      memoryLimitMiB: 4096,
      cpu: 2048,
      taskRole,
      executionRole,
    });
    
    // Create log groups
    webserverLogGroup = new logs.LogGroup(stack, 'WebserverLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    
    schedulerLogGroup = new logs.LogGroup(stack, 'SchedulerLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    
    workerLogGroup = new logs.LogGroup(stack, 'WorkerLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    
    triggerLogGroup = new logs.LogGroup(stack, 'TriggerLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    
    // Create Airflow containers
    airflowContainers = new AirflowContainers({
      taskDefinition,
      dbEndpointAddress: 'db.example.com',
      dbEndpointPort: '5432',
      redisEndpointAddress: 'redis.example.com',
      redisEndpointPort: '6379',
      webserverLogGroup,
      schedulerLogGroup,
      workerLogGroup,
      triggerLogGroup,
    });
  });

  test('creates webserver container', () => {
    // Check that the webserver container is created and has the correct properties
    expect(airflowContainers.webserver).toBeDefined();
    expect(airflowContainers.webserver.containerName).toBe('webserver');
    expect(airflowContainers.webserver.essential).toBe(true);
  });
  
  test('creates scheduler container', () => {
    // Check that the scheduler container is created and has the correct properties
    expect(airflowContainers.scheduler).toBeDefined();
    expect(airflowContainers.scheduler.containerName).toBe('scheduler');
    expect(airflowContainers.scheduler.essential).toBe(true);
  });
  
  test('creates worker container', () => {
    // Check that the worker container is created and has the correct properties
    expect(airflowContainers.worker).toBeDefined();
    expect(airflowContainers.worker.containerName).toBe('worker');
    expect(airflowContainers.worker.essential).toBe(true);
  });
  
  test('creates triggerer container', () => {
    // Check that the triggerer container is created and has the correct properties
    expect(airflowContainers.triggerer).toBeDefined();
    expect(airflowContainers.triggerer.containerName).toBe('triggerer');
    expect(airflowContainers.triggerer.essential).toBe(true);
  });
  
  test('webserver container exposes port 8080', () => {
    // Check that the webserver container has the correct port mapping
    const portMappings = (airflowContainers.webserver as any).portMappings;
    expect(portMappings).toBeDefined();
    expect(portMappings.length).toBe(1);
    expect(portMappings[0].containerPort).toBe(8080);
    expect(portMappings[0].hostPort).toBe(8080);
  });
  
  test('webserver container has health check', () => {
    // Check that the webserver container has a health check
    const healthCheck = (airflowContainers.webserver as any).healthCheck;
    expect(healthCheck).toBeDefined();
    expect(healthCheck.command[0]).toBe('CMD-SHELL');
    expect(healthCheck.command[1]).toContain('curl --fail http://localhost:8080/health');
  });
}); 