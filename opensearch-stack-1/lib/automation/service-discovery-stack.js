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
exports.ServiceDiscoveryStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
const eventsources = __importStar(require("aws-cdk-lib/aws-lambda-event-sources"));
class ServiceDiscoveryStack extends aws_cdk_lib_1.Stack {
    serviceRegistry;
    onboardingQueue;
    discoveryFunction;
    onboardingFunction;
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create DynamoDB table for service registry
        this.serviceRegistry = new dynamodb.Table(this, 'ServiceRegistry', {
            tableName: `opensearch-service-registry-${props.stage}`,
            partitionKey: {
                name: 'serviceName',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'environment',
                type: dynamodb.AttributeType.STRING
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecoverySpecification: {
                pointInTimeRecoveryEnabled: true
            },
            removalPolicy: props.stage === 'prod' ?
                aws_cdk_lib_1.RemovalPolicy.RETAIN :
                aws_cdk_lib_1.RemovalPolicy.DESTROY
        });
        // Add GSI for service status queries
        this.serviceRegistry.addGlobalSecondaryIndex({
            indexName: 'StatusIndex',
            partitionKey: {
                name: 'status',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'lastUpdated',
                type: dynamodb.AttributeType.STRING
            }
        });
        // Create SQS queue for onboarding workflow
        const dlq = new sqs.Queue(this, 'OnboardingDLQ', {
            queueName: `opensearch-onboarding-dlq-${props.stage}`
        });
        this.onboardingQueue = new sqs.Queue(this, 'OnboardingQueue', {
            queueName: `opensearch-onboarding-${props.stage}`,
            visibilityTimeout: aws_cdk_lib_1.Duration.minutes(15),
            deadLetterQueue: {
                queue: dlq,
                maxReceiveCount: 3
            }
        });
        // Service Discovery Lambda - monitors CloudWatch Log Groups
        this.discoveryFunction = new lambda.Function(this, 'ServiceDiscoveryFunction', {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'service_discovery.handler',
            code: lambda.Code.fromAsset('lambda/service-discovery'),
            timeout: aws_cdk_lib_1.Duration.minutes(5),
            memorySize: 512,
            environment: {
                SERVICE_REGISTRY_TABLE: this.serviceRegistry.tableName,
                ONBOARDING_QUEUE_URL: this.onboardingQueue.queueUrl,
                STAGE: props.stage,
                OPENSEARCH_DOMAIN: props.opensearchDomainName
            }
        });
        // Service Onboarding Lambda - provisions infrastructure
        this.onboardingFunction = new lambda.Function(this, 'ServiceOnboardingFunction', {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'service_onboarding.handler',
            code: lambda.Code.fromAsset('lambda/service-onboarding'),
            timeout: aws_cdk_lib_1.Duration.minutes(15),
            memorySize: 1024,
            environment: {
                SERVICE_REGISTRY_TABLE: this.serviceRegistry.tableName,
                STAGE: props.stage,
                OPENSEARCH_DOMAIN: props.opensearchDomainName,
                CDK_STACK_NAME: `${this.stackName}`
            }
        });
        // Grant permissions
        this.serviceRegistry.grantReadWriteData(this.discoveryFunction);
        this.serviceRegistry.grantReadWriteData(this.onboardingFunction);
        this.onboardingQueue.grantSendMessages(this.discoveryFunction);
        this.onboardingQueue.grantConsumeMessages(this.onboardingFunction);
        // Grant CloudWatch Logs permissions for discovery
        this.discoveryFunction.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
                'logs:GetLogEvents',
                'logs:DescribeSubscriptionFilters'
            ],
            resources: ['*']
        }));
        // Grant CDK and CloudFormation permissions for onboarding
        this.onboardingFunction.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'cloudformation:DescribeStacks',
                'cloudformation:CreateStack',
                'cloudformation:UpdateStack',
                'cloudformation:DeleteStack',
                'cloudformation:DescribeStackResources',
                'cloudformation:DescribeStackEvents',
                'iam:CreateRole',
                'iam:UpdateRole',
                'iam:GetRole',
                'iam:PassRole',
                'iam:AttachRolePolicy',
                'iam:DetachRolePolicy',
                'firehose:CreateDeliveryStream',
                'firehose:UpdateDeliveryStream',
                'firehose:DeleteDeliveryStream',
                'lambda:CreateFunction',
                'lambda:UpdateFunction',
                'lambda:DeleteFunction',
                's3:CreateBucket',
                's3:DeleteBucket',
                's3:PutBucketPublicAccessBlock',
                's3:PutBucketVersioning',
                's3:PutEncryptionConfiguration'
            ],
            resources: ['*']
        }));
        // Grant SSM Parameter Store access for configuration templates
        this.onboardingFunction.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ssm:GetParameter',
                'ssm:PutParameter',
                'ssm:GetParameters',
                'ssm:GetParametersByPath'
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/opensearch/${props.stage}/*`
            ]
        }));
        // CloudWatch Events rule for log group creation
        const logGroupCreationRule = new events.Rule(this, 'LogGroupCreationRule', {
            eventPattern: {
                source: ['aws.logs'],
                detailType: ['AWS API Call via CloudTrail'],
                detail: {
                    eventSource: ['logs.amazonaws.com'],
                    eventName: ['CreateLogGroup']
                }
            },
            description: 'Trigger service discovery when new log groups are created'
        });
        logGroupCreationRule.addTarget(new targets.LambdaFunction(this.discoveryFunction));
        // Scheduled rule for periodic discovery
        const periodicDiscoveryRule = new events.Rule(this, 'PeriodicDiscoveryRule', {
            schedule: events.Schedule.rate(aws_cdk_lib_1.Duration.hours(4)),
            description: 'Periodic service discovery scan'
        });
        periodicDiscoveryRule.addTarget(new targets.LambdaFunction(this.discoveryFunction, {
            event: events.RuleTargetInput.fromObject({
                source: 'periodic-scan',
                scanType: 'full'
            })
        }));
        // SQS trigger for onboarding function
        this.onboardingFunction.addEventSource(new eventsources.SqsEventSource(this.onboardingQueue, {
            batchSize: 1
        }));
        // Note: CloudWatch Log Groups for Lambda functions are created automatically
        // We don't need to explicitly create them to avoid conflicts
        // Create service template parameters in SSM
        this.createServiceTemplates(props.stage);
    }
    createServiceTemplates(stage) {
        // Database service template
        new ssm.StringParameter(this, 'DatabaseTemplate', {
            parameterName: `/opensearch/${stage}/templates/database`,
            stringValue: JSON.stringify({
                indexName: 'database-logs',
                processorType: 'database',
                filterPattern: '[timestamp, request_id, level="ERROR" || level="WARN" || level="INFO"]',
                bufferInterval: 60,
                bufferSize: 5,
                retryDuration: 300,
                indexMapping: {
                    properties: {
                        timestamp: { type: 'date' },
                        level: { type: 'keyword' },
                        message: { type: 'text' },
                        request_id: { type: 'keyword' },
                        database: { type: 'keyword' },
                        query_time: { type: 'float' }
                    }
                }
            })
        });
        // Kafka service template
        new ssm.StringParameter(this, 'KafkaTemplate', {
            parameterName: `/opensearch/${stage}/templates/kafka`,
            stringValue: JSON.stringify({
                indexName: 'kafka-logs',
                processorType: 'kafka',
                filterPattern: '[timestamp, level, logger, ...rest]',
                bufferInterval: 30,
                bufferSize: 1,
                retryDuration: 600,
                indexMapping: {
                    properties: {
                        timestamp: { type: 'date' },
                        level: { type: 'keyword' },
                        logger: { type: 'keyword' },
                        message: { type: 'text' },
                        broker_id: { type: 'keyword' },
                        topic: { type: 'keyword' },
                        partition: { type: 'integer' }
                    }
                }
            })
        });
        // Application service template
        new ssm.StringParameter(this, 'ApplicationTemplate', {
            parameterName: `/opensearch/${stage}/templates/application`,
            stringValue: JSON.stringify({
                indexName: 'app-logs',
                processorType: 'application',
                filterPattern: '',
                bufferInterval: 60,
                bufferSize: 5,
                retryDuration: 300,
                indexMapping: {
                    properties: {
                        timestamp: { type: 'date' },
                        level: { type: 'keyword' },
                        message: { type: 'text' },
                        service: { type: 'keyword' },
                        version: { type: 'keyword' },
                        trace_id: { type: 'keyword' }
                    }
                }
            })
        });
        // Default/generic template
        new ssm.StringParameter(this, 'GenericTemplate', {
            parameterName: `/opensearch/${stage}/templates/generic`,
            stringValue: JSON.stringify({
                indexName: 'generic-logs',
                processorType: 'generic',
                filterPattern: '',
                bufferInterval: 300,
                bufferSize: 5,
                retryDuration: 300,
                indexMapping: {
                    properties: {
                        timestamp: { type: 'date' },
                        message: { type: 'text' },
                        service: { type: 'keyword' },
                        level: { type: 'keyword' }
                    }
                }
            })
        });
    }
}
exports.ServiceDiscoveryStack = ServiceDiscoveryStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS1kaXNjb3Zlcnktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzZXJ2aWNlLWRpc2NvdmVyeS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDZDQUF5RTtBQUV6RSwrREFBaUQ7QUFFakQsK0RBQWlEO0FBQ2pELHdFQUEwRDtBQUMxRCx5REFBMkM7QUFDM0MsbUVBQXFEO0FBRXJELHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsbUZBQXFFO0FBUXJFLE1BQWEscUJBQXNCLFNBQVEsbUJBQUs7SUFDNUIsZUFBZSxDQUFpQjtJQUNoQyxlQUFlLENBQVk7SUFDM0IsaUJBQWlCLENBQWtCO0lBQ25DLGtCQUFrQixDQUFrQjtJQUVwRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWlDO1FBQ3ZFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDZDQUE2QztRQUM3QyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDL0QsU0FBUyxFQUFFLCtCQUErQixLQUFLLENBQUMsS0FBSyxFQUFFO1lBQ3ZELFlBQVksRUFBRTtnQkFDVixJQUFJLEVBQUUsYUFBYTtnQkFDbkIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUN0QztZQUNELE9BQU8sRUFBRTtnQkFDTCxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUN0QztZQUNELFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsZ0NBQWdDLEVBQUU7Z0JBQzlCLDBCQUEwQixFQUFFLElBQUk7YUFDbkM7WUFDRCxhQUFhLEVBQUUsS0FBSyxDQUFDLEtBQUssS0FBSyxNQUFNLENBQUMsQ0FBQztnQkFD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U0FDTCxDQUFDLENBQUM7SUFDUCxDQUFDO0NBQ0o7QUEzUkQsc0RBMlJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMsIER1cmF0aW9uLCBSZW1vdmFsUG9saWN5IH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyBzcXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcyc7XG5pbXBvcnQgKiBhcyBzc20gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgKiBhcyBldmVudHNvdXJjZXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzJztcbmltcG9ydCB7IFN0YWNrUHJvcHNFeHQgfSBmcm9tICcuLi9zdGFjay1jb21wb3Nlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VydmljZURpc2NvdmVyeVN0YWNrUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzRXh0IHtcbiAgICByZWFkb25seSBvcGVuc2VhcmNoRG9tYWluTmFtZTogc3RyaW5nO1xuICAgIHJlYWRvbmx5IG5vdGlmaWNhdGlvblRvcGljPzogc25zLlRvcGljO1xufVxuXG5leHBvcnQgY2xhc3MgU2VydmljZURpc2NvdmVyeVN0YWNrIGV4dGVuZHMgU3RhY2sge1xuICAgIHB1YmxpYyByZWFkb25seSBzZXJ2aWNlUmVnaXN0cnk6IGR5bmFtb2RiLlRhYmxlO1xuICAgIHB1YmxpYyByZWFkb25seSBvbmJvYXJkaW5nUXVldWU6IHNxcy5RdWV1ZTtcbiAgICBwdWJsaWMgcmVhZG9ubHkgZGlzY292ZXJ5RnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgICBwdWJsaWMgcmVhZG9ubHkgb25ib2FyZGluZ0Z1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gICAgXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFNlcnZpY2VEaXNjb3ZlcnlTdGFja1Byb3BzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBEeW5hbW9EQiB0YWJsZSBmb3Igc2VydmljZSByZWdpc3RyeVxuICAgICAgICB0aGlzLnNlcnZpY2VSZWdpc3RyeSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnU2VydmljZVJlZ2lzdHJ5Jywge1xuICAgICAgICAgICAgdGFibGVOYW1lOiBgb3BlbnNlYXJjaC1zZXJ2aWNlLXJlZ2lzdHJ5LSR7cHJvcHMuc3RhZ2V9YCxcbiAgICAgICAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdzZXJ2aWNlTmFtZScsXG4gICAgICAgICAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzb3J0S2V5OiB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2Vudmlyb25tZW50JyxcbiAgICAgICAgICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklOR1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICAgICAgICBwb2ludEluVGltZVJlY292ZXJ5U3BlY2lmaWNhdGlvbjoge1xuICAgICAgICAgICAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiB0cnVlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogcHJvcHMuc3RhZ2UgPT09ICdwcm9kJyA/IFxuICAgICAgICAgICAgICAgIFJlbW92YWxQb2xpY3kuUkVUQUlOIDogXG4gICAgICAgICAgICAgICAgUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBHU0kgZm9yIHNlcnZpY2Ugc3RhdHVzIHF1ZXJpZXNcbiAgICAgICAgdGhpcy5zZXJ2aWNlUmVnaXN0cnkuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgICAgICAgaW5kZXhOYW1lOiAnU3RhdHVzSW5kZXgnLFxuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ3N0YXR1cycsXG4gICAgICAgICAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzb3J0S2V5OiB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2xhc3RVcGRhdGVkJyxcbiAgICAgICAgICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklOR1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgU1FTIHF1ZXVlIGZvciBvbmJvYXJkaW5nIHdvcmtmbG93XG4gICAgICAgIGNvbnN0IGRscSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ09uYm9hcmRpbmdETFEnLCB7XG4gICAgICAgICAgICBxdWV1ZU5hbWU6IGBvcGVuc2VhcmNoLW9uYm9hcmRpbmctZGxxLSR7cHJvcHMuc3RhZ2V9YFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLm9uYm9hcmRpbmdRdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ09uYm9hcmRpbmdRdWV1ZScsIHtcbiAgICAgICAgICAgIHF1ZXVlTmFtZTogYG9wZW5zZWFyY2gtb25ib2FyZGluZy0ke3Byb3BzLnN0YWdlfWAsXG4gICAgICAgICAgICB2aXNpYmlsaXR5VGltZW91dDogRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICAgICAgICBkZWFkTGV0dGVyUXVldWU6IHtcbiAgICAgICAgICAgICAgICBxdWV1ZTogZGxxLFxuICAgICAgICAgICAgICAgIG1heFJlY2VpdmVDb3VudDogM1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBTZXJ2aWNlIERpc2NvdmVyeSBMYW1iZGEgLSBtb25pdG9ycyBDbG91ZFdhdGNoIExvZyBHcm91cHNcbiAgICAgICAgdGhpcy5kaXNjb3ZlcnlGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NlcnZpY2VEaXNjb3ZlcnlGdW5jdGlvbicsIHtcbiAgICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgICAgICAgaGFuZGxlcjogJ3NlcnZpY2VfZGlzY292ZXJ5LmhhbmRsZXInLFxuICAgICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEvc2VydmljZS1kaXNjb3ZlcnknKSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgIFNFUlZJQ0VfUkVHSVNUUllfVEFCTEU6IHRoaXMuc2VydmljZVJlZ2lzdHJ5LnRhYmxlTmFtZSxcbiAgICAgICAgICAgICAgICBPTkJPQVJESU5HX1FVRVVFX1VSTDogdGhpcy5vbmJvYXJkaW5nUXVldWUucXVldWVVcmwsXG4gICAgICAgICAgICAgICAgU1RBR0U6IHByb3BzLnN0YWdlLFxuICAgICAgICAgICAgICAgIE9QRU5TRUFSQ0hfRE9NQUlOOiBwcm9wcy5vcGVuc2VhcmNoRG9tYWluTmFtZVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBTZXJ2aWNlIE9uYm9hcmRpbmcgTGFtYmRhIC0gcHJvdmlzaW9ucyBpbmZyYXN0cnVjdHVyZVxuICAgICAgICB0aGlzLm9uYm9hcmRpbmdGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NlcnZpY2VPbmJvYXJkaW5nRnVuY3Rpb24nLCB7XG4gICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdzZXJ2aWNlX29uYm9hcmRpbmcuaGFuZGxlcicsXG4gICAgICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYS9zZXJ2aWNlLW9uYm9hcmRpbmcnKSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAgICAgU0VSVklDRV9SRUdJU1RSWV9UQUJMRTogdGhpcy5zZXJ2aWNlUmVnaXN0cnkudGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIFNUQUdFOiBwcm9wcy5zdGFnZSxcbiAgICAgICAgICAgICAgICBPUEVOU0VBUkNIX0RPTUFJTjogcHJvcHMub3BlbnNlYXJjaERvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgQ0RLX1NUQUNLX05BTUU6IGAke3RoaXMuc3RhY2tOYW1lfWBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICAgICAgdGhpcy5zZXJ2aWNlUmVnaXN0cnkuZ3JhbnRSZWFkV3JpdGVEYXRhKHRoaXMuZGlzY292ZXJ5RnVuY3Rpb24pO1xuICAgICAgICB0aGlzLnNlcnZpY2VSZWdpc3RyeS5ncmFudFJlYWRXcml0ZURhdGEodGhpcy5vbmJvYXJkaW5nRnVuY3Rpb24pO1xuICAgICAgICB0aGlzLm9uYm9hcmRpbmdRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyh0aGlzLmRpc2NvdmVyeUZ1bmN0aW9uKTtcbiAgICAgICAgdGhpcy5vbmJvYXJkaW5nUXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXModGhpcy5vbmJvYXJkaW5nRnVuY3Rpb24pO1xuXG4gICAgICAgIC8vIEdyYW50IENsb3VkV2F0Y2ggTG9ncyBwZXJtaXNzaW9ucyBmb3IgZGlzY292ZXJ5XG4gICAgICAgIHRoaXMuZGlzY292ZXJ5RnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ0dyb3VwcycsXG4gICAgICAgICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgICAgICAgICAgICAnbG9nczpHZXRMb2dFdmVudHMnLFxuICAgICAgICAgICAgICAgICdsb2dzOkRlc2NyaWJlU3Vic2NyaXB0aW9uRmlsdGVycydcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyBHcmFudCBDREsgYW5kIENsb3VkRm9ybWF0aW9uIHBlcm1pc3Npb25zIGZvciBvbmJvYXJkaW5nXG4gICAgICAgIHRoaXMub25ib2FyZGluZ0Z1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkRlc2NyaWJlU3RhY2tzJyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246Q3JlYXRlU3RhY2snLFxuICAgICAgICAgICAgICAgICdjbG91ZGZvcm1hdGlvbjpVcGRhdGVTdGFjaycsXG4gICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkRlbGV0ZVN0YWNrJyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246RGVzY3JpYmVTdGFja1Jlc291cmNlcycsXG4gICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkRlc2NyaWJlU3RhY2tFdmVudHMnLFxuICAgICAgICAgICAgICAgICdpYW06Q3JlYXRlUm9sZScsXG4gICAgICAgICAgICAgICAgJ2lhbTpVcGRhdGVSb2xlJyxcbiAgICAgICAgICAgICAgICAnaWFtOkdldFJvbGUnLFxuICAgICAgICAgICAgICAgICdpYW06UGFzc1JvbGUnLFxuICAgICAgICAgICAgICAgICdpYW06QXR0YWNoUm9sZVBvbGljeScsXG4gICAgICAgICAgICAgICAgJ2lhbTpEZXRhY2hSb2xlUG9saWN5JyxcbiAgICAgICAgICAgICAgICAnZmlyZWhvc2U6Q3JlYXRlRGVsaXZlcnlTdHJlYW0nLFxuICAgICAgICAgICAgICAgICdmaXJlaG9zZTpVcGRhdGVEZWxpdmVyeVN0cmVhbScsXG4gICAgICAgICAgICAgICAgJ2ZpcmVob3NlOkRlbGV0ZURlbGl2ZXJ5U3RyZWFtJyxcbiAgICAgICAgICAgICAgICAnbGFtYmRhOkNyZWF0ZUZ1bmN0aW9uJyxcbiAgICAgICAgICAgICAgICAnbGFtYmRhOlVwZGF0ZUZ1bmN0aW9uJyxcbiAgICAgICAgICAgICAgICAnbGFtYmRhOkRlbGV0ZUZ1bmN0aW9uJyxcbiAgICAgICAgICAgICAgICAnczM6Q3JlYXRlQnVja2V0JyxcbiAgICAgICAgICAgICAgICAnczM6RGVsZXRlQnVja2V0JyxcbiAgICAgICAgICAgICAgICAnczM6UHV0QnVja2V0UHVibGljQWNjZXNzQmxvY2snLFxuICAgICAgICAgICAgICAgICdzMzpQdXRCdWNrZXRWZXJzaW9uaW5nJyxcbiAgICAgICAgICAgICAgICAnczM6UHV0RW5jcnlwdGlvbkNvbmZpZ3VyYXRpb24nXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgLy8gR3JhbnQgU1NNIFBhcmFtZXRlciBTdG9yZSBhY2Nlc3MgZm9yIGNvbmZpZ3VyYXRpb24gdGVtcGxhdGVzXG4gICAgICAgIHRoaXMub25ib2FyZGluZ0Z1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXInLFxuICAgICAgICAgICAgICAgICdzc206UHV0UGFyYW1ldGVyJyxcbiAgICAgICAgICAgICAgICAnc3NtOkdldFBhcmFtZXRlcnMnLFxuICAgICAgICAgICAgICAgICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCdcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICBgYXJuOmF3czpzc206JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnBhcmFtZXRlci9vcGVuc2VhcmNoLyR7cHJvcHMuc3RhZ2V9LypgXG4gICAgICAgICAgICBdXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyBDbG91ZFdhdGNoIEV2ZW50cyBydWxlIGZvciBsb2cgZ3JvdXAgY3JlYXRpb25cbiAgICAgICAgY29uc3QgbG9nR3JvdXBDcmVhdGlvblJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0xvZ0dyb3VwQ3JlYXRpb25SdWxlJywge1xuICAgICAgICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgICAgICAgICAgc291cmNlOiBbJ2F3cy5sb2dzJ10sXG4gICAgICAgICAgICAgICAgZGV0YWlsVHlwZTogWydBV1MgQVBJIENhbGwgdmlhIENsb3VkVHJhaWwnXSxcbiAgICAgICAgICAgICAgICBkZXRhaWw6IHtcbiAgICAgICAgICAgICAgICAgICAgZXZlbnRTb3VyY2U6IFsnbG9ncy5hbWF6b25hd3MuY29tJ10sXG4gICAgICAgICAgICAgICAgICAgIGV2ZW50TmFtZTogWydDcmVhdGVMb2dHcm91cCddXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVHJpZ2dlciBzZXJ2aWNlIGRpc2NvdmVyeSB3aGVuIG5ldyBsb2cgZ3JvdXBzIGFyZSBjcmVhdGVkJ1xuICAgICAgICB9KTtcblxuICAgICAgICBsb2dHcm91cENyZWF0aW9uUnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24odGhpcy5kaXNjb3ZlcnlGdW5jdGlvbikpO1xuXG4gICAgICAgIC8vIFNjaGVkdWxlZCBydWxlIGZvciBwZXJpb2RpYyBkaXNjb3ZlcnlcbiAgICAgICAgY29uc3QgcGVyaW9kaWNEaXNjb3ZlcnlSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdQZXJpb2RpY0Rpc2NvdmVyeVJ1bGUnLCB7XG4gICAgICAgICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLnJhdGUoRHVyYXRpb24uaG91cnMoNCkpLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQZXJpb2RpYyBzZXJ2aWNlIGRpc2NvdmVyeSBzY2FuJ1xuICAgICAgICB9KTtcblxuICAgICAgICBwZXJpb2RpY0Rpc2NvdmVyeVJ1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRoaXMuZGlzY292ZXJ5RnVuY3Rpb24sIHtcbiAgICAgICAgICAgIGV2ZW50OiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21PYmplY3QoeyBcbiAgICAgICAgICAgICAgICBzb3VyY2U6ICdwZXJpb2RpYy1zY2FuJyxcbiAgICAgICAgICAgICAgICBzY2FuVHlwZTogJ2Z1bGwnIFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIC8vIFNRUyB0cmlnZ2VyIGZvciBvbmJvYXJkaW5nIGZ1bmN0aW9uXG4gICAgICAgIHRoaXMub25ib2FyZGluZ0Z1bmN0aW9uLmFkZEV2ZW50U291cmNlKFxuICAgICAgICAgICAgbmV3IGV2ZW50c291cmNlcy5TcXNFdmVudFNvdXJjZSh0aGlzLm9uYm9hcmRpbmdRdWV1ZSwge1xuICAgICAgICAgICAgICAgIGJhdGNoU2l6ZTogMVxuICAgICAgICAgICAgfSlcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBOb3RlOiBDbG91ZFdhdGNoIExvZyBHcm91cHMgZm9yIExhbWJkYSBmdW5jdGlvbnMgYXJlIGNyZWF0ZWQgYXV0b21hdGljYWxseVxuICAgICAgICAvLyBXZSBkb24ndCBuZWVkIHRvIGV4cGxpY2l0bHkgY3JlYXRlIHRoZW0gdG8gYXZvaWQgY29uZmxpY3RzXG5cbiAgICAgICAgLy8gQ3JlYXRlIHNlcnZpY2UgdGVtcGxhdGUgcGFyYW1ldGVycyBpbiBTU01cbiAgICAgICAgdGhpcy5jcmVhdGVTZXJ2aWNlVGVtcGxhdGVzKHByb3BzLnN0YWdlKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZVNlcnZpY2VUZW1wbGF0ZXMoc3RhZ2U6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICAvLyBEYXRhYmFzZSBzZXJ2aWNlIHRlbXBsYXRlXG4gICAgICAgIG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdEYXRhYmFzZVRlbXBsYXRlJywge1xuICAgICAgICAgICAgcGFyYW1ldGVyTmFtZTogYC9vcGVuc2VhcmNoLyR7c3RhZ2V9L3RlbXBsYXRlcy9kYXRhYmFzZWAsXG4gICAgICAgICAgICBzdHJpbmdWYWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2RhdGFiYXNlLWxvZ3MnLFxuICAgICAgICAgICAgICAgIHByb2Nlc3NvclR5cGU6ICdkYXRhYmFzZScsXG4gICAgICAgICAgICAgICAgZmlsdGVyUGF0dGVybjogJ1t0aW1lc3RhbXAsIHJlcXVlc3RfaWQsIGxldmVsPVwiRVJST1JcIiB8fCBsZXZlbD1cIldBUk5cIiB8fCBsZXZlbD1cIklORk9cIl0nLFxuICAgICAgICAgICAgICAgIGJ1ZmZlckludGVydmFsOiA2MCxcbiAgICAgICAgICAgICAgICBidWZmZXJTaXplOiA1LFxuICAgICAgICAgICAgICAgIHJldHJ5RHVyYXRpb246IDMwMCxcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmc6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGltZXN0YW1wOiB7IHR5cGU6ICdkYXRlJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgbGV2ZWw6IHsgdHlwZTogJ2tleXdvcmQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiB7IHR5cGU6ICd0ZXh0JyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWVzdF9pZDogeyB0eXBlOiAna2V5d29yZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGFiYXNlOiB7IHR5cGU6ICdrZXl3b3JkJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgcXVlcnlfdGltZTogeyB0eXBlOiAnZmxvYXQnIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEthZmthIHNlcnZpY2UgdGVtcGxhdGVcbiAgICAgICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0thZmthVGVtcGxhdGUnLCB7XG4gICAgICAgICAgICBwYXJhbWV0ZXJOYW1lOiBgL29wZW5zZWFyY2gvJHtzdGFnZX0vdGVtcGxhdGVzL2thZmthYCxcbiAgICAgICAgICAgIHN0cmluZ1ZhbHVlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiAna2Fma2EtbG9ncycsXG4gICAgICAgICAgICAgICAgcHJvY2Vzc29yVHlwZTogJ2thZmthJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJQYXR0ZXJuOiAnW3RpbWVzdGFtcCwgbGV2ZWwsIGxvZ2dlciwgLi4ucmVzdF0nLFxuICAgICAgICAgICAgICAgIGJ1ZmZlckludGVydmFsOiAzMCxcbiAgICAgICAgICAgICAgICBidWZmZXJTaXplOiAxLFxuICAgICAgICAgICAgICAgIHJldHJ5RHVyYXRpb246IDYwMCxcbiAgICAgICAgICAgICAgICBpbmRleE1hcHBpbmc6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGltZXN0YW1wOiB7IHR5cGU6ICdkYXRlJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgbGV2ZWw6IHsgdHlwZTogJ2tleXdvcmQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXI6IHsgdHlwZTogJ2tleXdvcmQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiB7IHR5cGU6ICd0ZXh0JyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgYnJva2VyX2lkOiB7IHR5cGU6ICdrZXl3b3JkJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgdG9waWM6IHsgdHlwZTogJ2tleXdvcmQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJ0aXRpb246IHsgdHlwZTogJ2ludGVnZXInIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFwcGxpY2F0aW9uIHNlcnZpY2UgdGVtcGxhdGVcbiAgICAgICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0FwcGxpY2F0aW9uVGVtcGxhdGUnLCB7XG4gICAgICAgICAgICBwYXJhbWV0ZXJOYW1lOiBgL29wZW5zZWFyY2gvJHtzdGFnZX0vdGVtcGxhdGVzL2FwcGxpY2F0aW9uYCxcbiAgICAgICAgICAgIHN0cmluZ1ZhbHVlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiAnYXBwLWxvZ3MnLFxuICAgICAgICAgICAgICAgIHByb2Nlc3NvclR5cGU6ICdhcHBsaWNhdGlvbicsXG4gICAgICAgICAgICAgICAgZmlsdGVyUGF0dGVybjogJycsXG4gICAgICAgICAgICAgICAgYnVmZmVySW50ZXJ2YWw6IDYwLFxuICAgICAgICAgICAgICAgIGJ1ZmZlclNpemU6IDUsXG4gICAgICAgICAgICAgICAgcmV0cnlEdXJhdGlvbjogMzAwLFxuICAgICAgICAgICAgICAgIGluZGV4TWFwcGluZzoge1xuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXA6IHsgdHlwZTogJ2RhdGUnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBsZXZlbDogeyB0eXBlOiAna2V5d29yZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHsgdHlwZTogJ3RleHQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXJ2aWNlOiB7IHR5cGU6ICdrZXl3b3JkJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogeyB0eXBlOiAna2V5d29yZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYWNlX2lkOiB7IHR5cGU6ICdrZXl3b3JkJyB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBEZWZhdWx0L2dlbmVyaWMgdGVtcGxhdGVcbiAgICAgICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0dlbmVyaWNUZW1wbGF0ZScsIHtcbiAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6IGAvb3BlbnNlYXJjaC8ke3N0YWdlfS90ZW1wbGF0ZXMvZ2VuZXJpY2AsXG4gICAgICAgICAgICBzdHJpbmdWYWx1ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2dlbmVyaWMtbG9ncycsXG4gICAgICAgICAgICAgICAgcHJvY2Vzc29yVHlwZTogJ2dlbmVyaWMnLFxuICAgICAgICAgICAgICAgIGZpbHRlclBhdHRlcm46ICcnLFxuICAgICAgICAgICAgICAgIGJ1ZmZlckludGVydmFsOiAzMDAsXG4gICAgICAgICAgICAgICAgYnVmZmVyU2l6ZTogNSxcbiAgICAgICAgICAgICAgICByZXRyeUR1cmF0aW9uOiAzMDAsXG4gICAgICAgICAgICAgICAgaW5kZXhNYXBwaW5nOiB7XG4gICAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogeyB0eXBlOiAnZGF0ZScgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHsgdHlwZTogJ3RleHQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXJ2aWNlOiB7IHR5cGU6ICdrZXl3b3JkJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgbGV2ZWw6IHsgdHlwZTogJ2tleXdvcmQnIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgIH1cbn0iXX0=