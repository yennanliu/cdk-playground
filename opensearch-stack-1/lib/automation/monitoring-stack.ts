import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import { StackPropsExt } from '../stack-composer';

export interface MonitoringStackProps extends StackPropsExt {
    readonly serviceRegistry: dynamodb.Table;
    readonly onboardingQueue: sqs.Queue;
    readonly opensearchDomainName: string;
    readonly notificationEmail?: string;
    readonly slackWebhook?: string;
}

export class MonitoringStack extends Stack {
    public readonly notificationTopic: sns.Topic;
    public readonly alertingFunction: lambda.Function;
    public readonly healthCheckFunction: lambda.Function;
    public dashboard: cloudwatch.Dashboard;
    
    constructor(scope: Construct, id: string, props: MonitoringStackProps) {
        super(scope, id, props);

        // Create SNS topic for notifications
        this.notificationTopic = new sns.Topic(this, 'ServiceNotificationTopic', {
            topicName: `opensearch-service-notifications-${props.stage}`,
            displayName: 'OpenSearch Service Management Notifications'
        });

        // Add email subscription if provided
        if (props.notificationEmail) {
            this.notificationTopic.addSubscription(
                new subscriptions.EmailSubscription(props.notificationEmail)
            );
        }

        // Create alerting Lambda function
        this.alertingFunction = new lambda.Function(this, 'AlertingFunction', {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'alerting.handler',
            code: lambda.Code.fromAsset('lambda/monitoring'),
            timeout: Duration.minutes(5),
            memorySize: 512,
            environment: {
                SERVICE_REGISTRY_TABLE: props.serviceRegistry.tableName,
                NOTIFICATION_TOPIC_ARN: this.notificationTopic.topicArn,
                STAGE: props.stage,
                OPENSEARCH_DOMAIN: props.opensearchDomainName,
                SLACK_WEBHOOK: props.slackWebhook || ''
            }
        });

        // Create health check Lambda function
        this.healthCheckFunction = new lambda.Function(this, 'HealthCheckFunction', {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'health_check.handler',
            code: lambda.Code.fromAsset('lambda/monitoring'),
            timeout: Duration.minutes(10),
            memorySize: 1024,
            environment: {
                SERVICE_REGISTRY_TABLE: props.serviceRegistry.tableName,
                NOTIFICATION_TOPIC_ARN: this.notificationTopic.topicArn,
                ONBOARDING_QUEUE_URL: props.onboardingQueue.queueUrl,
                STAGE: props.stage,
                OPENSEARCH_DOMAIN: props.opensearchDomainName
            }
        });

        // Grant permissions
        props.serviceRegistry.grantReadWriteData(this.alertingFunction);
        props.serviceRegistry.grantReadData(this.healthCheckFunction);
        props.onboardingQueue.grantSendMessages(this.healthCheckFunction);
        this.notificationTopic.grantPublish(this.alertingFunction);
        this.notificationTopic.grantPublish(this.healthCheckFunction);

        // Grant CloudWatch and other AWS service permissions
        const monitoringPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'cloudwatch:GetMetricStatistics',
                'cloudwatch:ListMetrics',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
                'logs:GetLogEvents',
                'firehose:DescribeDeliveryStream',
                'firehose:ListDeliveryStreams',
                'opensearch:DescribeDomain',
                'opensearch:DescribeDomains',
                'opensearch:ListDomainNames',
                'es:DescribeElasticsearchDomain',
                'es:DescribeElasticsearchDomains',
                'cloudformation:DescribeStacks',
                'cloudformation:ListStacks',
                'sqs:GetQueueAttributes'
            ],
            resources: ['*']
        });

        this.alertingFunction.addToRolePolicy(monitoringPolicy);
        this.healthCheckFunction.addToRolePolicy(monitoringPolicy);

        // Create CloudWatch Alarms
        this.createAlarms(props);

        // Create EventBridge rules for automated monitoring
        this.createEventRules(props);

        // Create CloudWatch Dashboard
        this.createDashboard(props);

        // Note: CloudWatch Log Groups for Lambda functions are created automatically
    }

    private createAlarms(props: MonitoringStackProps): void {
        // Onboarding queue depth alarm
        const queueDepthAlarm = new cloudwatch.Alarm(this, 'OnboardingQueueDepthAlarm', {
            alarmName: `opensearch-onboarding-queue-depth-${props.stage}`,
            alarmDescription: 'High number of messages in onboarding queue',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/SQS',
                metricName: 'ApproximateNumberOfVisibleMessages',
                dimensionsMap: {
                    QueueName: props.onboardingQueue.queueName
                }
            }),
            threshold: 10,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
        });

        queueDepthAlarm.addAlarmAction({
            bind: () => ({ alarmActionArn: this.notificationTopic.topicArn })
        });

        // Lambda error rate alarm
        const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorRateAlarm', {
            alarmName: `opensearch-lambda-errors-${props.stage}`,
            alarmDescription: 'High error rate in service management Lambdas',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'Errors',
                dimensionsMap: {
                    FunctionName: this.alertingFunction.functionName
                },
                statistic: 'Sum'
            }),
            threshold: 5,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
        });

        lambdaErrorAlarm.addAlarmAction({
            bind: () => ({ alarmActionArn: this.notificationTopic.topicArn })
        });

        // Failed onboarding services alarm (custom metric)
        const failedServicesAlarm = new cloudwatch.Alarm(this, 'FailedServicesAlarm', {
            alarmName: `opensearch-failed-services-${props.stage}`,
            alarmDescription: 'High number of failed service onboarding attempts',
            metric: new cloudwatch.Metric({
                namespace: 'OpenSearch/ServiceManagement',
                metricName: 'FailedServices',
                dimensionsMap: {
                    Environment: props.stage
                }
            }),
            threshold: 3,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD
        });

        failedServicesAlarm.addAlarmAction({
            bind: () => ({ alarmActionArn: this.notificationTopic.topicArn })
        });
    }

    private createEventRules(props: MonitoringStackProps): void {
        // Periodic health check - every 30 minutes
        const healthCheckRule = new events.Rule(this, 'HealthCheckRule', {
            schedule: events.Schedule.rate(Duration.minutes(30)),
            description: 'Periodic health check for OpenSearch service management'
        });

        healthCheckRule.addTarget(new targets.LambdaFunction(this.healthCheckFunction, {
            event: events.RuleTargetInput.fromObject({
                source: 'scheduled-health-check',
                timestamp: events.RuleTargetInput.fromText('$.time')
            })
        }));

        // DLQ message alert
        const dlqRule = new events.Rule(this, 'DLQMessageRule', {
            eventPattern: {
                source: ['aws.sqs'],
                detailType: ['SQS Queue Message'],
                detail: {
                    queueName: [props.onboardingQueue.queueName + '-dlq']
                }
            },
            description: 'Alert when messages arrive in DLQ'
        });

        dlqRule.addTarget(new targets.LambdaFunction(this.alertingFunction, {
            event: events.RuleTargetInput.fromObject({
                source: 'dlq-message',
                alertType: 'critical',
                message: 'Message sent to Dead Letter Queue'
            })
        }));

        // CloudFormation stack failures
        const cfnFailureRule = new events.Rule(this, 'CloudFormationFailureRule', {
            eventPattern: {
                source: ['aws.cloudformation'],
                detailType: ['CloudFormation Stack Status Change'],
                detail: {
                    'status-details': {
                        status: ['CREATE_FAILED', 'UPDATE_FAILED', 'DELETE_FAILED']
                    }
                }
            },
            description: 'Alert on CloudFormation stack failures'
        });

        cfnFailureRule.addTarget(new targets.LambdaFunction(this.alertingFunction, {
            event: events.RuleTargetInput.fromObject({
                source: 'cloudformation-failure',
                alertType: 'high',
                stackName: events.RuleTargetInput.fromText('$.detail.stack-name'),
                status: events.RuleTargetInput.fromText('$.detail.status-details.status')
            })
        }));
    }

    private createDashboard(props: MonitoringStackProps): void {
        this.dashboard = new cloudwatch.Dashboard(this, 'ServiceManagementDashboard', {
            dashboardName: `opensearch-service-management-${props.stage}`,
            defaultInterval: Duration.minutes(5)
        });

        // Service Registry Metrics
        const serviceRegistryWidget = new cloudwatch.GraphWidget({
            title: 'Service Registry Status',
            width: 12,
            height: 6,
            left: [
                new cloudwatch.Metric({
                    namespace: 'OpenSearch/ServiceManagement',
                    metricName: 'TotalServices',
                    dimensionsMap: { Environment: props.stage }
                }),
                new cloudwatch.Metric({
                    namespace: 'OpenSearch/ServiceManagement', 
                    metricName: 'OnboardedServices',
                    dimensionsMap: { Environment: props.stage }
                }),
                new cloudwatch.Metric({
                    namespace: 'OpenSearch/ServiceManagement',
                    metricName: 'FailedServices',
                    dimensionsMap: { Environment: props.stage }
                })
            ]
        });

        // Queue Metrics
        const queueWidget = new cloudwatch.GraphWidget({
            title: 'Onboarding Queue Metrics',
            width: 12,
            height: 6,
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/SQS',
                    metricName: 'NumberOfMessagesSent',
                    dimensionsMap: { QueueName: props.onboardingQueue.queueName }
                }),
                new cloudwatch.Metric({
                    namespace: 'AWS/SQS',
                    metricName: 'NumberOfMessagesReceived',
                    dimensionsMap: { QueueName: props.onboardingQueue.queueName }
                }),
                new cloudwatch.Metric({
                    namespace: 'AWS/SQS',
                    metricName: 'ApproximateNumberOfVisibleMessages',
                    dimensionsMap: { QueueName: props.onboardingQueue.queueName }
                })
            ]
        });

        // Lambda Performance
        const lambdaWidget = new cloudwatch.GraphWidget({
            title: 'Lambda Function Performance',
            width: 24,
            height: 6,
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/Lambda',
                    metricName: 'Duration',
                    dimensionsMap: { FunctionName: this.alertingFunction.functionName },
                    statistic: 'Average'
                }),
                new cloudwatch.Metric({
                    namespace: 'AWS/Lambda',
                    metricName: 'Invocations',
                    dimensionsMap: { FunctionName: this.alertingFunction.functionName }
                }),
                new cloudwatch.Metric({
                    namespace: 'AWS/Lambda',
                    metricName: 'Errors',
                    dimensionsMap: { FunctionName: this.alertingFunction.functionName }
                })
            ]
        });

        // Service Onboarding Timeline - Simple text widget for now
        const onboardingTimelineWidget = new cloudwatch.TextWidget({
            markdown: `# Recent Service Onboarding Events

Check the following log groups for recent activity:
- \`/aws/lambda/opensearch-service-discovery-${props.stage}\`
- \`/aws/lambda/opensearch-service-onboarding-${props.stage}\``,
            width: 24,
            height: 6
        });

        // Add widgets to dashboard
        this.dashboard.addWidgets(
            serviceRegistryWidget,
            queueWidget,
            lambdaWidget,
            onboardingTimelineWidget
        );
    }
}