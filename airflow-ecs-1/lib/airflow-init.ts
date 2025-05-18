import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AirflowInitProps {
  scope: Construct;
  cluster: ecs.ICluster;
  taskDefinition: ecs.TaskDefinition;
  dbEndpointAddress: string;
  dbEndpointPort: string;
  securityGroups: ec2.SecurityGroup[];
  vpcSubnets: ec2.SubnetSelection;
  logGroup: logs.LogGroup;
}

export class AirflowInit {
  public readonly initTask: ecs.FargateService;
  
  constructor(props: AirflowInitProps) {
    // Create the init container
    const initContainer = props.taskDefinition.addContainer('init', {
      image: ecs.ContainerImage.fromRegistry('apache/airflow:3.0.1'),
      command: [
        'bash', 
        '-c', 
        'airflow db init && ' +
        'airflow users create --username airflow --password airflow --firstname Admin ' +
        '--lastname User --role Admin --email admin@example.com'
      ],
      environment: {
        AIRFLOW__CORE__EXECUTOR: 'LocalExecutor',
        AIRFLOW__DATABASE__SQL_ALCHEMY_CONN: `postgresql://postgres:postgres@${props.dbEndpointAddress}:${props.dbEndpointPort}/airflow`,
        AIRFLOW_HOME: '/opt/airflow',
        AIRFLOW__CORE__LOAD_EXAMPLES: 'false',
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'init',
        logGroup: props.logGroup,
      }),
      essential: true,
    });

    // Create a one-time task to initialize Airflow
    this.initTask = new ecs.FargateService(props.scope, 'AirflowInitTask', {
      cluster: props.cluster,
      taskDefinition: props.taskDefinition,
      desiredCount: 0, // Run once and then stop
      securityGroups: props.securityGroups,
      vpcSubnets: props.vpcSubnets,
      assignPublicIp: false,
    });

    // Add auto-scaling policy to scale to 1 to run the init task once
    const scaling = this.initTask.autoScaleTaskCount({
      minCapacity: 0,
      maxCapacity: 1,
    });

    // Run the task once during deployment
    scaling.scaleToTrackCustomMetric('RunInitTask', {
      targetValue: 1,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          ClusterName: props.cluster.clusterName,
          ServiceName: this.initTask.serviceName,
        },
        statistic: 'Average',
        period: Duration.seconds(60),
      }),
    });
  }
} 