import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Duration } from 'aws-cdk-lib';

export interface AirflowContainerProps {
  taskDefinition: ecs.TaskDefinition;
  dbEndpointAddress: string;
  dbEndpointPort: string; 
  redisEndpointAddress: string;
  redisEndpointPort: string;
  webserverLogGroup: logs.LogGroup;
  schedulerLogGroup: logs.LogGroup;
  workerLogGroup: logs.LogGroup;
  triggerLogGroup: logs.LogGroup;
}

export class AirflowContainers {
  public readonly webserver: ecs.ContainerDefinition;
  public readonly scheduler: ecs.ContainerDefinition;
  public readonly worker: ecs.ContainerDefinition;
  public readonly triggerer: ecs.ContainerDefinition;

  constructor(props: AirflowContainerProps) {
    const commonEnv = {
      AIRFLOW__CORE__EXECUTOR: 'CeleryExecutor',
      AIRFLOW__DATABASE__SQL_ALCHEMY_CONN: `postgresql://postgres:postgres@${props.dbEndpointAddress}:${props.dbEndpointPort}/airflow`,
      AIRFLOW__CELERY__BROKER_URL: `redis://${props.redisEndpointAddress}:${props.redisEndpointPort}/0`,
      AIRFLOW__CELERY__RESULT_BACKEND: `db+postgresql://postgres:postgres@${props.dbEndpointAddress}:${props.dbEndpointPort}/airflow`,
      AIRFLOW_HOME: '/opt/airflow',
      AIRFLOW__CORE__DAGS_FOLDER: '/opt/airflow/dags',
      AIRFLOW__CORE__LOAD_EXAMPLES: 'false',
      AIRFLOW__WEBSERVER__RBAC: 'true',
    };

    // Add webserver container
    this.webserver = props.taskDefinition.addContainer('webserver', {
      image: ecs.ContainerImage.fromRegistry('apache/airflow:3.0.1'),
      command: ['webserver'],
      environment: {
        ...commonEnv,
        AIRFLOW__WEBSERVER__EXPOSE_CONFIG: 'true',
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'webserver',
        logGroup: props.webserverLogGroup,
      }),
      portMappings: [{
        containerPort: 8080,
        hostPort: 8080,
      }],
      healthCheck: {
        command: ['CMD-SHELL', 'curl --fail http://localhost:8080/health || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      essential: true,
    });

    // Add scheduler container
    this.scheduler = props.taskDefinition.addContainer('scheduler', {
      image: ecs.ContainerImage.fromRegistry('apache/airflow:3.0.1'),
      command: ['scheduler'],
      environment: commonEnv,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'scheduler',
        logGroup: props.schedulerLogGroup,
      }),
      essential: true,
    });

    // Add worker container
    this.worker = props.taskDefinition.addContainer('worker', {
      image: ecs.ContainerImage.fromRegistry('apache/airflow:3.0.1'),
      command: ['celery', 'worker'],
      environment: commonEnv,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'worker',
        logGroup: props.workerLogGroup,
      }),
      essential: true,
    });

    // Add triggerer container
    this.triggerer = props.taskDefinition.addContainer('triggerer', {
      image: ecs.ContainerImage.fromRegistry('apache/airflow:3.0.1'),
      command: ['triggerer'],
      environment: commonEnv,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'triggerer',
        logGroup: props.triggerLogGroup,
      }),
      essential: true,
    });
  }
} 