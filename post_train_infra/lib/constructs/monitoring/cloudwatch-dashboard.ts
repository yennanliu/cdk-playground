import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

export interface CloudWatchDashboardProps {
  resourcePrefix: string;
  clusterName: string;
}

export class CloudWatchDashboardConstruct extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly dashboardName: string;

  constructor(scope: Construct, id: string, props: CloudWatchDashboardProps) {
    super(scope, id);

    this.dashboardName = `${props.resourcePrefix}-dashboard`;

    // Create CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: this.dashboardName,
      defaultInterval: Duration.hours(3),
    });

    // Create log groups
    const trainingLogGroup = new logs.LogGroup(this, 'TrainingLogs', {
      logGroupName: `/aws/eks/${props.clusterName}/post-train/training`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const inferenceLogGroup = new logs.LogGroup(this, 'InferenceLogs', {
      logGroupName: `/aws/eks/${props.clusterName}/post-train/inference`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const weaviateLogGroup = new logs.LogGroup(this, 'WeaviateLogs', {
      logGroupName: `/aws/eks/${props.clusterName}/post-train/weaviate`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const ragLogGroup = new logs.LogGroup(this, 'RagLogs', {
      logGroupName: `/aws/eks/${props.clusterName}/post-train/rag`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // GPU Utilization widget
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'GPU Utilization',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'ContainerInsights',
            metricName: 'pod_nvidia_gpu_utilization',
            dimensionsMap: {
              Namespace: 'post-train',
            },
            statistic: 'Average',
            label: 'Avg GPU Utilization',
          }),
        ],
      })
    );

    // GPU Memory utilization
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'GPU Memory Utilization',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'ContainerInsights',
            metricName: 'pod_nvidia_gpu_memory_utilization',
            dimensionsMap: {
              Namespace: 'post-train',
            },
            statistic: 'Average',
            label: 'Avg GPU Memory %',
          }),
        ],
      })
    );

    // Pod CPU utilization
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Pod CPU Utilization',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'ContainerInsights',
            metricName: 'pod_cpu_utilization',
            dimensionsMap: {
              Namespace: 'post-train',
            },
            statistic: 'Average',
            label: 'Avg CPU %',
          }),
        ],
      })
    );

    // Pod Memory utilization
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Pod Memory Utilization',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'ContainerInsights',
            metricName: 'pod_memory_utilization',
            dimensionsMap: {
              Namespace: 'post-train',
            },
            statistic: 'Average',
            label: 'Avg Memory %',
          }),
        ],
      })
    );

    // vLLM latency metrics (custom metrics published by application)
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'vLLM Request Latency',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'vllm_request_latency',
            statistic: 'p50',
            label: 'P50',
          }),
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'vllm_request_latency',
            statistic: 'p90',
            label: 'P90',
          }),
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'vllm_request_latency',
            statistic: 'p99',
            label: 'P99',
          }),
        ],
      })
    );

    // vLLM throughput
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'vLLM Request Rate',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'vllm_requests',
            statistic: 'Sum',
            period: Duration.minutes(1),
            label: 'Requests/min',
          }),
        ],
      })
    );

    // Training loss (custom metric published during training)
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Training Loss',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'training_loss',
            statistic: 'Average',
            label: 'Loss',
          }),
        ],
      })
    );

    // Training progress
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Training Progress',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'training_step',
            statistic: 'Maximum',
            label: 'Current Step',
          }),
        ],
      })
    );

    // Weaviate query latency
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Weaviate Query Latency',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'weaviate_query_latency',
            statistic: 'Average',
            label: 'Avg Latency (ms)',
          }),
        ],
      })
    );

    // RAG query latency
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RAG End-to-End Latency',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'rag_query_latency',
            statistic: 'p50',
            label: 'P50',
          }),
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'rag_query_latency',
            statistic: 'p90',
            label: 'P90',
          }),
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'rag_query_latency',
            statistic: 'p99',
            label: 'P99',
          }),
        ],
      })
    );

    // RAG request rate
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RAG Request Rate',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'rag_requests',
            statistic: 'Sum',
            period: Duration.minutes(1),
            label: 'Requests/min',
          }),
        ],
      })
    );

    // Error rate
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Error Rate',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'errors',
            dimensionsMap: {
              Service: 'vllm',
            },
            statistic: 'Sum',
            label: 'vLLM Errors',
          }),
          new cloudwatch.Metric({
            namespace: 'PostTrain',
            metricName: 'errors',
            dimensionsMap: {
              Service: 'rag',
            },
            statistic: 'Sum',
            label: 'RAG Errors',
          }),
        ],
      })
    );

    // Create CloudWatch Alarms

    // Training job failure alarm
    new cloudwatch.Alarm(this, 'TrainingJobFailureAlarm', {
      alarmName: `${props.resourcePrefix}-training-job-failure`,
      metric: new cloudwatch.Metric({
        namespace: 'PostTrain',
        metricName: 'TrainingJobFailures',
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Training job has failed',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // GPU OOM alarm
    new cloudwatch.Alarm(this, 'GpuOomAlarm', {
      alarmName: `${props.resourcePrefix}-gpu-oom`,
      metric: new cloudwatch.Metric({
        namespace: 'ContainerInsights',
        metricName: 'pod_memory_utilization',
        dimensionsMap: {
          Namespace: 'post-train',
        },
        statistic: 'Average',
      }),
      threshold: 95,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'GPU pod memory utilization > 95%',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // vLLM high latency alarm
    new cloudwatch.Alarm(this, 'VllmHighLatencyAlarm', {
      alarmName: `${props.resourcePrefix}-vllm-high-latency`,
      metric: new cloudwatch.Metric({
        namespace: 'PostTrain',
        metricName: 'vllm_request_latency',
        statistic: 'p99',
      }),
      threshold: 5000, // 5 seconds
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'vLLM P99 latency > 5 seconds',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // RAG high error rate alarm
    new cloudwatch.Alarm(this, 'RagHighErrorRateAlarm', {
      alarmName: `${props.resourcePrefix}-rag-high-error-rate`,
      metric: new cloudwatch.Metric({
        namespace: 'PostTrain',
        metricName: 'errors',
        dimensionsMap: {
          Service: 'rag',
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'RAG error rate > 10 errors in 5 minutes',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Weaviate unavailable alarm
    new cloudwatch.Alarm(this, 'WeaviateUnavailableAlarm', {
      alarmName: `${props.resourcePrefix}-weaviate-unavailable`,
      metric: new cloudwatch.Metric({
        namespace: 'ContainerInsights',
        metricName: 'pod_number_of_containers',
        dimensionsMap: {
          Namespace: 'post-train',
          PodName: 'weaviate-*',
        },
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'Weaviate has less than 1 running pod',
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
  }
}
