"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const subscriptions = __importStar(require("aws-cdk-lib/aws-sns-subscriptions"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
class MonitoringStack extends aws_cdk_lib_1.Stack {
    notificationTopic;
    alertingFunction;
    healthCheckFunction;
    dashboard;
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create SNS topic for notifications
        this.notificationTopic = new sns.Topic(this, 'ServiceNotificationTopic', {
            topicName: `opensearch-service-notifications-${props.stage}`,
            displayName: 'OpenSearch Service Management Notifications'
        });
        // Add email subscription if provided
        if (props.notificationEmail) {
            this.notificationTopic.addSubscription(new subscriptions.EmailSubscription(props.notificationEmail));
        }
        // Create alerting Lambda function
        this.alertingFunction = new lambda.Function(this, 'AlertingFunction', {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'alerting.handler',
            code: lambda.Code.fromAsset('lambda/monitoring'),
            timeout: aws_cdk_lib_1.Duration.minutes(5),
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
            timeout: aws_cdk_lib_1.Duration.minutes(10),
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
    createAlarms(props) {
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
    createEventRules(props) {
        // Periodic health check - every 30 minutes
        const healthCheckRule = new events.Rule(this, 'HealthCheckRule', {
            schedule: events.Schedule.rate(aws_cdk_lib_1.Duration.minutes(30)),
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
    createDashboard(props) {
        this.dashboard = new cloudwatch.Dashboard(this, 'ServiceManagementDashboard', {
            dashboardName: `opensearch-service-management-${props.stage}`,
            defaultInterval: aws_cdk_lib_1.Duration.minutes(5)
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
        this.dashboard.addWidgets(serviceRegistryWidget, queueWidget, lambdaWidget, onboardingTimelineWidget);
    }
}
exports.MonitoringStack = MonitoringStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uaXRvcmluZy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1vbml0b3Jpbmctc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw2Q0FBMEQ7QUFFMUQsdUVBQXlEO0FBQ3pELHlEQUEyQztBQUUzQywrREFBaUQ7QUFDakQsaUZBQW1FO0FBQ25FLCtEQUFpRDtBQUNqRCx3RUFBMEQ7QUFDMUQseURBQTJDO0FBYTNDLE1BQWEsZUFBZ0IsU0FBUSxtQkFBSztJQUN0QixpQkFBaUIsQ0FBWTtJQUM3QixnQkFBZ0IsQ0FBa0I7SUFDbEMsbUJBQW1CLENBQWtCO0lBQzlDLFNBQVMsQ0FBdUI7SUFFdkMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEyQjtRQUNqRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixxQ0FBcUM7UUFDckMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDckUsU0FBUyxFQUFFLG9DQUFvQyxLQUFLLENBQUMsS0FBSyxFQUFFO1lBQzVELFdBQVcsRUFBRSw2Q0FBNkM7U0FDN0QsQ0FBQyxDQUFDO1FBRUgscUNBQXFDO1FBQ3JDLElBQUksS0FBSyxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDMUIsSUFBSSxDQUFDLGlCQUFpQixDQUFDLGVBQWUsQ0FDbEMsSUFBSSxhQUFhLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLENBQy9ELENBQUM7UUFDTixDQUFDO1FBRUQsa0NBQWtDO1FBQ2xDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ2xFLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsT0FB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QUFDO1FBRUgsMkRBQTJEO1FBQzNELE1BQU0sd0JBQXdCLEdBQUcsSUFBSSxVQUFVLENBQUMsVUFBVSxDQUFDO1lBQ3ZELFFBQVEsRUFBRTs7OytDQUd5QixLQUFLLENBQUMsS0FBSztnREFDVixLQUFLLENBQUMsS0FBSyxJQUFJO1lBQ25ELEtBQUssRUFBRSxFQUFFO1lBQ1QsTUFBTSxFQUFFLENBQUM7U0FDWixDQUFDLENBQUM7UUFFSCwyQkFBMkI7UUFDM0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQ3JCLHFCQUFxQixFQUNyQixXQUFXLEVBQ1gsWUFBWSxFQUNaLHdCQUF3QixDQUMzQixDQUFDO0lBQ04sQ0FBQztDQUNKO0FBOVRELDBDQThUQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBTdGFja1Byb3BzLCBEdXJhdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyBzcXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzdWJzY3JpcHRpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0cyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBTdGFja1Byb3BzRXh0IH0gZnJvbSAnLi4vc3RhY2stY29tcG9zZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIE1vbml0b3JpbmdTdGFja1Byb3BzIGV4dGVuZHMgU3RhY2tQcm9wc0V4dCB7XG4gICAgcmVhZG9ubHkgc2VydmljZVJlZ2lzdHJ5OiBkeW5hbW9kYi5UYWJsZTtcbiAgICByZWFkb25seSBvbmJvYXJkaW5nUXVldWU6IHNxcy5RdWV1ZTtcbiAgICByZWFkb25seSBvcGVuc2VhcmNoRG9tYWluTmFtZTogc3RyaW5nO1xuICAgIHJlYWRvbmx5IG5vdGlmaWNhdGlvbkVtYWlsPzogc3RyaW5nO1xuICAgIHJlYWRvbmx5IHNsYWNrV2ViaG9vaz86IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIE1vbml0b3JpbmdTdGFjayBleHRlbmRzIFN0YWNrIHtcbiAgICBwdWJsaWMgcmVhZG9ubHkgbm90aWZpY2F0aW9uVG9waWM6IHNucy5Ub3BpYztcbiAgICBwdWJsaWMgcmVhZG9ubHkgYWxlcnRpbmdGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xuICAgIHB1YmxpYyByZWFkb25seSBoZWFsdGhDaGVja0Z1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gICAgcHVibGljIGRhc2hib2FyZDogY2xvdWR3YXRjaC5EYXNoYm9hcmQ7XG4gICAgXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE1vbml0b3JpbmdTdGFja1Byb3BzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBTTlMgdG9waWMgZm9yIG5vdGlmaWNhdGlvbnNcbiAgICAgICAgdGhpcy5ub3RpZmljYXRpb25Ub3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ1NlcnZpY2VOb3RpZmljYXRpb25Ub3BpYycsIHtcbiAgICAgICAgICAgIHRvcGljTmFtZTogYG9wZW5zZWFyY2gtc2VydmljZS1ub3RpZmljYXRpb25zLSR7cHJvcHMuc3RhZ2V9YCxcbiAgICAgICAgICAgIGRpc3BsYXlOYW1lOiAnT3BlblNlYXJjaCBTZXJ2aWNlIE1hbmFnZW1lbnQgTm90aWZpY2F0aW9ucydcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQWRkIGVtYWlsIHN1YnNjcmlwdGlvbiBpZiBwcm92aWRlZFxuICAgICAgICBpZiAocHJvcHMubm90aWZpY2F0aW9uRW1haWwpIHtcbiAgICAgICAgICAgIHRoaXMubm90aWZpY2F0aW9uVG9waWMuYWRkU3Vic2NyaXB0aW9uKFxuICAgICAgICAgICAgICAgIG5ldyBzdWJzY3JpcHRpb25zLkVtYWlsU3Vic2NyaXB0aW9uKHByb3BzLm5vdGlmaWNhdGlvbkVtYWlsKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBhbGVydGluZyBMYW1iZGEgZnVuY3Rpb25cbiAgICAgICAgdGhpcy5hbGVydGluZ0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQWxlcnRpbmdGdW5jdGlvbicsIHtcbiAgICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgICAgICAgaGFuZGxlcjogJ2FsZXJ0aW5nLmhhbmRsZXInLFxuICAgICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEvbW9uaXRvcmluZycpLFxuICAgICAgICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAgICAgU0VSVklDRV9SRUdJU1RSWV9UQUJMRTogcHJvcHMuc2VydmljZVJlZ2lzdHJ5LnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBOT1RJRklDQVRJT05fVE9QSUNfQVJOOiB0aGlzLm5vdGlmaWNhdGlvblRvcGljLnRvcGljQXJuLFxuICAgICAgICAgICAgICAgIFNUQUdFOiBwcm9wcy5zdGFnZSxcbiAgICAgICAgICAgICAgICBPUEVOU0VBUkNIX0RPTUFJTjogcHJvcHMub3BlbnNlYXJjaERvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgU0xBQ0tfV0VCSE9PSzogcHJvcHMuc2xhY2tXZWJob29rIHx8ICcnXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBoZWFsdGggY2hlY2sgTGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgIHRoaXMuaGVhbHRoQ2hlY2tGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0hlYWx0aENoZWNrRnVuY3Rpb24nLCB7XG4gICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdoZWFsdGhfY2hlY2suaGFuZGxlcicsXG4gICAgICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYS9tb25pdG9yaW5nJyksXG4gICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5taW51dGVzKDEwKSxcbiAgICAgICAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgIFNFUlZJQ0VfUkVHSVNUUllfVEFCTEU6IHByb3BzLnNlcnZpY2VSZWdpc3RyeS50YWJsZU5hbWUsXG4gICAgICAgICAgICAgICAgTk9USUZJQ0FUSU9OX1RPUElDX0FSTjogdGhpcy5ub3RpZmljYXRpb25Ub3BpYy50b3BpY0FybixcbiAgICAgICAgICAgICAgICBPTkJPQVJESU5HX1FVRVVFX1VSTDogcHJvcHMub25ib2FyZGluZ1F1ZXVlLnF1ZXVlVXJsLFxuICAgICAgICAgICAgICAgIFNUQUdFOiBwcm9wcy5zdGFnZSxcbiAgICAgICAgICAgICAgICBPUEVOU0VBUkNIX0RPTUFJTjogcHJvcHMub3BlbnNlYXJjaERvbWFpbk5hbWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICAgICAgcHJvcHMuc2VydmljZVJlZ2lzdHJ5LmdyYW50UmVhZFdyaXRlRGF0YSh0aGlzLmFsZXJ0aW5nRnVuY3Rpb24pO1xuICAgICAgICBwcm9wcy5zZXJ2aWNlUmVnaXN0cnkuZ3JhbnRSZWFkRGF0YSh0aGlzLmhlYWx0aENoZWNrRnVuY3Rpb24pO1xuICAgICAgICBwcm9wcy5vbmJvYXJkaW5nUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXModGhpcy5oZWFsdGhDaGVja0Z1bmN0aW9uKTtcbiAgICAgICAgdGhpcy5ub3RpZmljYXRpb25Ub3BpYy5ncmFudFB1Ymxpc2godGhpcy5hbGVydGluZ0Z1bmN0aW9uKTtcbiAgICAgICAgdGhpcy5ub3RpZmljYXRpb25Ub3BpYy5ncmFudFB1Ymxpc2godGhpcy5oZWFsdGhDaGVja0Z1bmN0aW9uKTtcblxuICAgICAgICAvLyBHcmFudCBDbG91ZFdhdGNoIGFuZCBvdGhlciBBV1Mgc2VydmljZSBwZXJtaXNzaW9uc1xuICAgICAgICBjb25zdCBtb25pdG9yaW5nUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdjbG91ZHdhdGNoOkdldE1ldHJpY1N0YXRpc3RpY3MnLFxuICAgICAgICAgICAgICAgICdjbG91ZHdhdGNoOkxpc3RNZXRyaWNzJyxcbiAgICAgICAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ0dyb3VwcycsXG4gICAgICAgICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgICAgICAgICAgICAnbG9nczpHZXRMb2dFdmVudHMnLFxuICAgICAgICAgICAgICAgICdmaXJlaG9zZTpEZXNjcmliZURlbGl2ZXJ5U3RyZWFtJyxcbiAgICAgICAgICAgICAgICAnZmlyZWhvc2U6TGlzdERlbGl2ZXJ5U3RyZWFtcycsXG4gICAgICAgICAgICAgICAgJ29wZW5zZWFyY2g6RGVzY3JpYmVEb21haW4nLFxuICAgICAgICAgICAgICAgICdvcGVuc2VhcmNoOkRlc2NyaWJlRG9tYWlucycsXG4gICAgICAgICAgICAgICAgJ29wZW5zZWFyY2g6TGlzdERvbWFpbk5hbWVzJyxcbiAgICAgICAgICAgICAgICAnZXM6RGVzY3JpYmVFbGFzdGljc2VhcmNoRG9tYWluJyxcbiAgICAgICAgICAgICAgICAnZXM6RGVzY3JpYmVFbGFzdGljc2VhcmNoRG9tYWlucycsXG4gICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkRlc2NyaWJlU3RhY2tzJyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246TGlzdFN0YWNrcycsXG4gICAgICAgICAgICAgICAgJ3NxczpHZXRRdWV1ZUF0dHJpYnV0ZXMnXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmFsZXJ0aW5nRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG1vbml0b3JpbmdQb2xpY3kpO1xuICAgICAgICB0aGlzLmhlYWx0aENoZWNrRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG1vbml0b3JpbmdQb2xpY3kpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIEFsYXJtc1xuICAgICAgICB0aGlzLmNyZWF0ZUFsYXJtcyhwcm9wcyk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIEV2ZW50QnJpZGdlIHJ1bGVzIGZvciBhdXRvbWF0ZWQgbW9uaXRvcmluZ1xuICAgICAgICB0aGlzLmNyZWF0ZUV2ZW50UnVsZXMocHJvcHMpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIERhc2hib2FyZFxuICAgICAgICB0aGlzLmNyZWF0ZURhc2hib2FyZChwcm9wcyk7XG5cbiAgICAgICAgLy8gTm90ZTogQ2xvdWRXYXRjaCBMb2cgR3JvdXBzIGZvciBMYW1iZGEgZnVuY3Rpb25zIGFyZSBjcmVhdGVkIGF1dG9tYXRpY2FsbHlcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZUFsYXJtcyhwcm9wczogTW9uaXRvcmluZ1N0YWNrUHJvcHMpOiB2b2lkIHtcbiAgICAgICAgLy8gT25ib2FyZGluZyBxdWV1ZSBkZXB0aCBhbGFybVxuICAgICAgICBjb25zdCBxdWV1ZURlcHRoQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnT25ib2FyZGluZ1F1ZXVlRGVwdGhBbGFybScsIHtcbiAgICAgICAgICAgIGFsYXJtTmFtZTogYG9wZW5zZWFyY2gtb25ib2FyZGluZy1xdWV1ZS1kZXB0aC0ke3Byb3BzLnN0YWdlfWAsXG4gICAgICAgICAgICBhbGFybURlc2NyaXB0aW9uOiAnSGlnaCBudW1iZXIgb2YgbWVzc2FnZXMgaW4gb25ib2FyZGluZyBxdWV1ZScsXG4gICAgICAgICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL1NRUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FwcHJveGltYXRlTnVtYmVyT2ZWaXNpYmxlTWVzc2FnZXMnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgICAgICAgUXVldWVOYW1lOiBwcm9wcy5vbmJvYXJkaW5nUXVldWUucXVldWVOYW1lXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICB0aHJlc2hvbGQ6IDEwLFxuICAgICAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTERcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcXVldWVEZXB0aEFsYXJtLmFkZEFsYXJtQWN0aW9uKHtcbiAgICAgICAgICAgIGJpbmQ6ICgpID0+ICh7IGFsYXJtQWN0aW9uQXJuOiB0aGlzLm5vdGlmaWNhdGlvblRvcGljLnRvcGljQXJuIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIExhbWJkYSBlcnJvciByYXRlIGFsYXJtXG4gICAgICAgIGNvbnN0IGxhbWJkYUVycm9yQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhRXJyb3JSYXRlQWxhcm0nLCB7XG4gICAgICAgICAgICBhbGFybU5hbWU6IGBvcGVuc2VhcmNoLWxhbWJkYS1lcnJvcnMtJHtwcm9wcy5zdGFnZX1gLFxuICAgICAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0hpZ2ggZXJyb3IgcmF0ZSBpbiBzZXJ2aWNlIG1hbmFnZW1lbnQgTGFtYmRhcycsXG4gICAgICAgICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0Vycm9ycycsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICAgICAgICBGdW5jdGlvbk5hbWU6IHRoaXMuYWxlcnRpbmdGdW5jdGlvbi5mdW5jdGlvbk5hbWVcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgdGhyZXNob2xkOiA1LFxuICAgICAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTERcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGFtYmRhRXJyb3JBbGFybS5hZGRBbGFybUFjdGlvbih7XG4gICAgICAgICAgICBiaW5kOiAoKSA9PiAoeyBhbGFybUFjdGlvbkFybjogdGhpcy5ub3RpZmljYXRpb25Ub3BpYy50b3BpY0FybiB9KVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBGYWlsZWQgb25ib2FyZGluZyBzZXJ2aWNlcyBhbGFybSAoY3VzdG9tIG1ldHJpYylcbiAgICAgICAgY29uc3QgZmFpbGVkU2VydmljZXNBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdGYWlsZWRTZXJ2aWNlc0FsYXJtJywge1xuICAgICAgICAgICAgYWxhcm1OYW1lOiBgb3BlbnNlYXJjaC1mYWlsZWQtc2VydmljZXMtJHtwcm9wcy5zdGFnZX1gLFxuICAgICAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0hpZ2ggbnVtYmVyIG9mIGZhaWxlZCBzZXJ2aWNlIG9uYm9hcmRpbmcgYXR0ZW1wdHMnLFxuICAgICAgICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ09wZW5TZWFyY2gvU2VydmljZU1hbmFnZW1lbnQnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdGYWlsZWRTZXJ2aWNlcycsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICAgICAgICBFbnZpcm9ubWVudDogcHJvcHMuc3RhZ2VcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIHRocmVzaG9sZDogMyxcbiAgICAgICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xEXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZhaWxlZFNlcnZpY2VzQWxhcm0uYWRkQWxhcm1BY3Rpb24oe1xuICAgICAgICAgICAgYmluZDogKCkgPT4gKHsgYWxhcm1BY3Rpb25Bcm46IHRoaXMubm90aWZpY2F0aW9uVG9waWMudG9waWNBcm4gfSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVFdmVudFJ1bGVzKHByb3BzOiBNb25pdG9yaW5nU3RhY2tQcm9wcyk6IHZvaWQge1xuICAgICAgICAvLyBQZXJpb2RpYyBoZWFsdGggY2hlY2sgLSBldmVyeSAzMCBtaW51dGVzXG4gICAgICAgIGNvbnN0IGhlYWx0aENoZWNrUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnSGVhbHRoQ2hlY2tSdWxlJywge1xuICAgICAgICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKER1cmF0aW9uLm1pbnV0ZXMoMzApKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUGVyaW9kaWMgaGVhbHRoIGNoZWNrIGZvciBPcGVuU2VhcmNoIHNlcnZpY2UgbWFuYWdlbWVudCdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaGVhbHRoQ2hlY2tSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0aGlzLmhlYWx0aENoZWNrRnVuY3Rpb24sIHtcbiAgICAgICAgICAgIGV2ZW50OiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogJ3NjaGVkdWxlZC1oZWFsdGgtY2hlY2snLFxuICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogZXZlbnRzLlJ1bGVUYXJnZXRJbnB1dC5mcm9tVGV4dCgnJC50aW1lJylcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyBETFEgbWVzc2FnZSBhbGVydFxuICAgICAgICBjb25zdCBkbHFSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdETFFNZXNzYWdlUnVsZScsIHtcbiAgICAgICAgICAgIGV2ZW50UGF0dGVybjoge1xuICAgICAgICAgICAgICAgIHNvdXJjZTogWydhd3Muc3FzJ10sXG4gICAgICAgICAgICAgICAgZGV0YWlsVHlwZTogWydTUVMgUXVldWUgTWVzc2FnZSddLFxuICAgICAgICAgICAgICAgIGRldGFpbDoge1xuICAgICAgICAgICAgICAgICAgICBxdWV1ZU5hbWU6IFtwcm9wcy5vbmJvYXJkaW5nUXVldWUucXVldWVOYW1lICsgJy1kbHEnXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0FsZXJ0IHdoZW4gbWVzc2FnZXMgYXJyaXZlIGluIERMUSdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZGxxUnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24odGhpcy5hbGVydGluZ0Z1bmN0aW9uLCB7XG4gICAgICAgICAgICBldmVudDogZXZlbnRzLlJ1bGVUYXJnZXRJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6ICdkbHEtbWVzc2FnZScsXG4gICAgICAgICAgICAgICAgYWxlcnRUeXBlOiAnY3JpdGljYWwnLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdNZXNzYWdlIHNlbnQgdG8gRGVhZCBMZXR0ZXIgUXVldWUnXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgLy8gQ2xvdWRGb3JtYXRpb24gc3RhY2sgZmFpbHVyZXNcbiAgICAgICAgY29uc3QgY2ZuRmFpbHVyZVJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0Nsb3VkRm9ybWF0aW9uRmFpbHVyZVJ1bGUnLCB7XG4gICAgICAgICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFsnYXdzLmNsb3VkZm9ybWF0aW9uJ10sXG4gICAgICAgICAgICAgICAgZGV0YWlsVHlwZTogWydDbG91ZEZvcm1hdGlvbiBTdGFjayBTdGF0dXMgQ2hhbmdlJ10sXG4gICAgICAgICAgICAgICAgZGV0YWlsOiB7XG4gICAgICAgICAgICAgICAgICAgICdzdGF0dXMtZGV0YWlscyc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogWydDUkVBVEVfRkFJTEVEJywgJ1VQREFURV9GQUlMRUQnLCAnREVMRVRFX0ZBSUxFRCddXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBbGVydCBvbiBDbG91ZEZvcm1hdGlvbiBzdGFjayBmYWlsdXJlcydcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY2ZuRmFpbHVyZVJ1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRoaXMuYWxlcnRpbmdGdW5jdGlvbiwge1xuICAgICAgICAgICAgZXZlbnQ6IGV2ZW50cy5SdWxlVGFyZ2V0SW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgICAgICAgICAgc291cmNlOiAnY2xvdWRmb3JtYXRpb24tZmFpbHVyZScsXG4gICAgICAgICAgICAgICAgYWxlcnRUeXBlOiAnaGlnaCcsXG4gICAgICAgICAgICAgICAgc3RhY2tOYW1lOiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21UZXh0KCckLmRldGFpbC5zdGFjay1uYW1lJyksXG4gICAgICAgICAgICAgICAgc3RhdHVzOiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21UZXh0KCckLmRldGFpbC5zdGF0dXMtZGV0YWlscy5zdGF0dXMnKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlRGFzaGJvYXJkKHByb3BzOiBNb25pdG9yaW5nU3RhY2tQcm9wcyk6IHZvaWQge1xuICAgICAgICB0aGlzLmRhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCAnU2VydmljZU1hbmFnZW1lbnREYXNoYm9hcmQnLCB7XG4gICAgICAgICAgICBkYXNoYm9hcmROYW1lOiBgb3BlbnNlYXJjaC1zZXJ2aWNlLW1hbmFnZW1lbnQtJHtwcm9wcy5zdGFnZX1gLFxuICAgICAgICAgICAgZGVmYXVsdEludGVydmFsOiBEdXJhdGlvbi5taW51dGVzKDUpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFNlcnZpY2UgUmVnaXN0cnkgTWV0cmljc1xuICAgICAgICBjb25zdCBzZXJ2aWNlUmVnaXN0cnlXaWRnZXQgPSBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ1NlcnZpY2UgUmVnaXN0cnkgU3RhdHVzJyxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdPcGVuU2VhcmNoL1NlcnZpY2VNYW5hZ2VtZW50JyxcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ1RvdGFsU2VydmljZXMnLFxuICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEVudmlyb25tZW50OiBwcm9wcy5zdGFnZSB9XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnT3BlblNlYXJjaC9TZXJ2aWNlTWFuYWdlbWVudCcsIFxuICAgICAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnT25ib2FyZGVkU2VydmljZXMnLFxuICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEVudmlyb25tZW50OiBwcm9wcy5zdGFnZSB9XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnT3BlblNlYXJjaC9TZXJ2aWNlTWFuYWdlbWVudCcsXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdGYWlsZWRTZXJ2aWNlcycsXG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRW52aXJvbm1lbnQ6IHByb3BzLnN0YWdlIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBRdWV1ZSBNZXRyaWNzXG4gICAgICAgIGNvbnN0IHF1ZXVlV2lkZ2V0ID0gbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdPbmJvYXJkaW5nIFF1ZXVlIE1ldHJpY3MnLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9TUVMnLFxuICAgICAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnTnVtYmVyT2ZNZXNzYWdlc1NlbnQnLFxuICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFF1ZXVlTmFtZTogcHJvcHMub25ib2FyZGluZ1F1ZXVlLnF1ZXVlTmFtZSB9XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL1NRUycsXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdOdW1iZXJPZk1lc3NhZ2VzUmVjZWl2ZWQnLFxuICAgICAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFF1ZXVlTmFtZTogcHJvcHMub25ib2FyZGluZ1F1ZXVlLnF1ZXVlTmFtZSB9XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL1NRUycsXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBcHByb3hpbWF0ZU51bWJlck9mVmlzaWJsZU1lc3NhZ2VzJyxcbiAgICAgICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBRdWV1ZU5hbWU6IHByb3BzLm9uYm9hcmRpbmdRdWV1ZS5xdWV1ZU5hbWUgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIExhbWJkYSBQZXJmb3JtYW5jZVxuICAgICAgICBjb25zdCBsYW1iZGFXaWRnZXQgPSBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0xhbWJkYSBGdW5jdGlvbiBQZXJmb3JtYW5jZScsXG4gICAgICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdEdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRnVuY3Rpb25OYW1lOiB0aGlzLmFsZXJ0aW5nRnVuY3Rpb24uZnVuY3Rpb25OYW1lIH0sXG4gICAgICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdJbnZvY2F0aW9ucycsXG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRnVuY3Rpb25OYW1lOiB0aGlzLmFsZXJ0aW5nRnVuY3Rpb24uZnVuY3Rpb25OYW1lIH1cbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvTGFtYmRhJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0Vycm9ycycsXG4gICAgICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRnVuY3Rpb25OYW1lOiB0aGlzLmFsZXJ0aW5nRnVuY3Rpb24uZnVuY3Rpb25OYW1lIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBTZXJ2aWNlIE9uYm9hcmRpbmcgVGltZWxpbmUgLSBTaW1wbGUgdGV4dCB3aWRnZXQgZm9yIG5vd1xuICAgICAgICBjb25zdCBvbmJvYXJkaW5nVGltZWxpbmVXaWRnZXQgPSBuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgICAgIG1hcmtkb3duOiBgIyBSZWNlbnQgU2VydmljZSBPbmJvYXJkaW5nIEV2ZW50c1xuXG5DaGVjayB0aGUgZm9sbG93aW5nIGxvZyBncm91cHMgZm9yIHJlY2VudCBhY3Rpdml0eTpcbi0gXFxgL2F3cy9sYW1iZGEvb3BlbnNlYXJjaC1zZXJ2aWNlLWRpc2NvdmVyeS0ke3Byb3BzLnN0YWdlfVxcYFxuLSBcXGAvYXdzL2xhbWJkYS9vcGVuc2VhcmNoLXNlcnZpY2Utb25ib2FyZGluZy0ke3Byb3BzLnN0YWdlfVxcYGAsXG4gICAgICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgICAgICBoZWlnaHQ6IDZcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQWRkIHdpZGdldHMgdG8gZGFzaGJvYXJkXG4gICAgICAgIHRoaXMuZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICAgICAgICBzZXJ2aWNlUmVnaXN0cnlXaWRnZXQsXG4gICAgICAgICAgICBxdWV1ZVdpZGdldCxcbiAgICAgICAgICAgIGxhbWJkYVdpZGdldCxcbiAgICAgICAgICAgIG9uYm9hcmRpbmdUaW1lbGluZVdpZGdldFxuICAgICAgICApO1xuICAgIH1cbn0iXX0=