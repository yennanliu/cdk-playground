import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a CloudWatch log group
    const logGroup = new logs.LogGroup(this, 'WordPressLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create a CloudWatch alarm for high CPU utilization
    new cloudwatch.Alarm(this, 'HighCpuAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 2,
      alarmDescription: 'Alarm if CPU utilization exceeds 80%',
    });
  }
}