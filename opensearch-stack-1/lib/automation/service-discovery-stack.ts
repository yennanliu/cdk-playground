import { Stack, StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import { StackPropsExt } from '../stack-composer';

export interface ServiceDiscoveryStackProps extends StackPropsExt {
    readonly opensearchDomainName: string;
    readonly notificationTopic?: sns.Topic;
}

export class ServiceDiscoveryStack extends Stack {
    public readonly serviceRegistry: dynamodb.Table;
    public readonly onboardingQueue: sqs.Queue;
    public readonly discoveryFunction: lambda.Function;
    public readonly onboardingFunction: lambda.Function;
    
    constructor(scope: Construct, id: string, props: ServiceDiscoveryStackProps) {
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
                RemovalPolicy.RETAIN : 
                RemovalPolicy.DESTROY
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
            visibilityTimeout: Duration.minutes(15),
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
            timeout: Duration.minutes(5),
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
            timeout: Duration.minutes(15),
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
                'firehose:DescribeDeliveryStream',
                'lambda:CreateFunction',
                'lambda:UpdateFunction',
                'lambda:DeleteFunction',
                'logs:CreateSubscriptionFilter',
                'logs:DeleteSubscriptionFilter',
                'logs:DescribeSubscriptionFilters',
                'logs:PutSubscriptionFilter',
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
            schedule: events.Schedule.rate(Duration.hours(4)),
            description: 'Periodic service discovery scan'
        });

        periodicDiscoveryRule.addTarget(new targets.LambdaFunction(this.discoveryFunction, {
            event: events.RuleTargetInput.fromObject({ 
                source: 'periodic-scan',
                scanType: 'full' 
            })
        }));

        // SQS trigger for onboarding function
        this.onboardingFunction.addEventSource(
            new eventsources.SqsEventSource(this.onboardingQueue, {
                batchSize: 1
            })
        );

        // Note: CloudWatch Log Groups for Lambda functions are created automatically
        // We don't need to explicitly create them to avoid conflicts

        // Create service template parameters in SSM
        this.createServiceTemplates(props.stage);
    }

    private createServiceTemplates(stage: string): void {
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