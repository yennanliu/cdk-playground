import { Stack, StackProps, RemovalPolicy, Duration, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { StackPropsExt } from './stack-composer';

export interface KinesisFirehoseStackProps extends StackPropsExt {
    readonly opensearchDomain: opensearch.Domain;
    readonly opensearchIndex: string;
    readonly opensearchStackName: string;
    readonly serviceLogGroupName?: string;  // Service log group name for subscription filter
    readonly serviceName?: string;  // Service identifier (eks, pod, database, etc.)
    readonly processorType?: string;  // Processor type for Lambda function
}

export class KinesisFirehoseStack extends Stack {
    constructor(scope: Construct, id: string, props: KinesisFirehoseStackProps) {
        super(scope, id, props);

        // Create S3 bucket for Firehose backup
        const backupBucket = new s3.Bucket(this, `${this.stackName}-FirehoseBackupBucket`, {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Import the Firehose role ARN from the OpenSearch stack
        const firehoseRoleArn = Fn.importValue(`${props.opensearchStackName}-FirehoseRoleArn`);
        const firehoseRole = iam.Role.fromRoleArn(this, 'ImportedFirehoseRole', firehoseRoleArn);

        // Grant the imported role permissions to write to this stack's S3 bucket
        backupBucket.grantReadWrite(firehoseRole);

        // Create Lambda function for processing CloudWatch Logs data
        let processorLambda: lambda.Function | undefined;
        const processingType = this.determineProcessingType(props);
        const logGroupName = props.serviceLogGroupName;
        
        if (processingType && this.shouldCreateProcessor(processingType)) {
            const lambdaPath = this.getLambdaPath(processingType);
            
            processorLambda = new lambda.Function(this, `${this.stackName}-LogProcessor`, {
                runtime: lambda.Runtime.NODEJS_18_X,
                handler: 'index.handler',
                code: lambda.Code.fromAsset(lambdaPath),
                timeout: Duration.minutes(5),
                memorySize: 512,
                description: `${processingType.toUpperCase()} logs processor for CloudWatch Logs data to Firehose`,
                environment: {
                    PROCESSING_TYPE: processingType,
                    LOG_TYPE: processingType,
                    SERVICE_NAME: props.serviceName || processingType
                }
            });

            // Grant Firehose permission to invoke the Lambda function
            processorLambda.grantInvoke(firehoseRole);
        }

        // Create Kinesis Firehose with unique naming based on domain
        const domainName = props.opensearchDomain.domainName.replace(/[^a-zA-Z0-9-]/g, '');
        const uniqueSuffix = this.node.addr.substring(0, 8); // Use unique CDK node address
        const deliveryStream = new firehose.CfnDeliveryStream(this, `${this.stackName}-OpenSearchDeliveryStream`, {
            deliveryStreamName: `${props.opensearchIndex}-${domainName}-${this.stackName.substring(0, 20)}`.substring(0, 64),
            deliveryStreamType: 'DirectPut',
            amazonopensearchserviceDestinationConfiguration: {
                indexName: props.opensearchIndex,
                domainArn: props.opensearchDomain.domainArn,
                roleArn: firehoseRole.roleArn,
                indexRotationPeriod: 'NoRotation',  // Prevent date-based indices
                bufferingHints: {
                    intervalInSeconds: 60,  // Standard buffering interval
                    sizeInMBs: 1  // Smaller buffer for faster testing - documents will be delivered more frequently
                },
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: `/aws/kinesisfirehose/${domainName}-${props.opensearchIndex}-${uniqueSuffix}`,
                    logStreamName: `${domainName}-${props.opensearchIndex}-Delivery`
                },
                processingConfiguration: this.getProcessingConfiguration(processorLambda, processingType),
                s3BackupMode: 'FailedDocumentsOnly',  // Only backup failed deliveries
                s3Configuration: {
                    bucketArn: backupBucket.bucketArn,
                    roleArn: firehoseRole.roleArn,
                    bufferingHints: {
                        intervalInSeconds: 60,  // S3 backup requires minimum 60 seconds
                        sizeInMBs: 1
                    }
                },
                retryOptions: {
                    durationInSeconds: 300
                }
            }
        });

        // Create CloudWatch Logs for Firehose operations (not for subscription)
        const logGroup = new LogGroup(this, `${this.stackName}-FirehoseLogGroup`, {
            logGroupName: `/aws/firehose/${domainName}-${props.opensearchIndex}-${uniqueSuffix}`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        // Create CloudWatch Logs destination and subscription filter
        if (logGroupName && this.shouldCreateSubscriptionFilter(processingType)) {
            // Import the CloudWatch Logs role ARN from the OpenSearch stack
            const cloudwatchLogsRoleArn = Fn.importValue(`${props.opensearchStackName}-CloudWatchLogsRoleArn`);
            
            // Create CloudWatch Logs destination
            const logsDestination = new logs.CfnDestination(this, `${this.stackName}-LogsDestination`, {
                destinationName: `${domainName}-${props.opensearchIndex}-${uniqueSuffix}-dest`,
                targetArn: deliveryStream.attrArn,
                roleArn: cloudwatchLogsRoleArn,
                destinationPolicy: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [{
                        Effect: 'Allow',
                        Principal: {
                            AWS: this.account
                        },
                        Action: 'logs:PutSubscriptionFilter',
                        Resource: `arn:aws:logs:${this.region}:${this.account}:destination:${this.stackName}-${props.opensearchIndex}-firehose-destination`
                    }]
                })
            });

            // Ensure destination is created after the delivery stream
            logsDestination.addDependency(deliveryStream);

            // Add CloudWatch Logs subscription filter
            if (logGroupName) {
                try {
                    // Create subscription filter to send logs to Firehose
                    const subscriptionFilter = new logs.CfnSubscriptionFilter(this, `${this.stackName}-LogsSubscriptionFilter`, {
                        logGroupName: logGroupName,
                        destinationArn: deliveryStream.attrArn,
                        roleArn: cloudwatchLogsRoleArn,
                        filterPattern: this.getFilterPattern(processingType), 
                        filterName: `${domainName}-${props.opensearchIndex}-${uniqueSuffix}-filter`
                    });

                    // Ensure the subscription filter is created after the delivery stream
                    subscriptionFilter.addDependency(deliveryStream);
                } catch (error) {
                    console.warn(`Could not create subscription filter for log group ${logGroupName}: ${error}`);
                }
            }
        }
    }

    private determineProcessingType(props: KinesisFirehoseStackProps): string | undefined {
        // Use explicit processorType if provided
        if (props.processorType) {
            return props.processorType;
        }

        // Determine from service name if provided
        if (props.serviceName) {
            return props.serviceName;
        }

        // Backward compatibility: determine from index name
        if (props.opensearchIndex === 'eks-logs') {
            return 'eks';
        }
        if (props.opensearchIndex === 'pod-logs') {
            return 'pod';
        }

        // Default for unknown services
        return undefined;
    }

    private shouldCreateProcessor(processingType: string): boolean {
        // Define which processing types need Lambda processors
        const typesNeedingProcessors = ['eks', 'pod', 'database', 'kafka', 'application'];
        return typesNeedingProcessors.includes(processingType);
    }

    private getLambdaPath(processingType: string): string {
        // Define Lambda paths for different processing types
        const lambdaPaths: { [key: string]: string } = {
            'eks': 'lambda/firehose-processor',
            'pod': 'lambda/pod-logs-processor',
            'database': 'lambda/unified-processor',
            'kafka': 'lambda/unified-processor', 
            'application': 'lambda/unified-processor'
        };
        
        return lambdaPaths[processingType] || 'lambda/unified-processor';
    }

    private shouldCreateSubscriptionFilter(processingType?: string): boolean {
        // Define which processing types need subscription filters
        const typesNeedingSubscriptions = ['eks', 'pod', 'database', 'kafka', 'application'];
        return processingType ? typesNeedingSubscriptions.includes(processingType) : false;
    }

    private getFilterPattern(processingType?: string): string {
        // Define filter patterns for different processing types
        const filterPatterns: { [key: string]: string } = {
            'eks': '',  // All EKS logs
            'pod': '',  // All Pod logs
            'database': '[timestamp, request_id, level="ERROR" || level="WARN" || level="INFO"]', // Database logs
            'kafka': '[timestamp, level, logger, ...rest]',  // Kafka logs
            'application': ''  // All application logs
        };
        
        return processingType ? (filterPatterns[processingType] || '') : '';
    }

    private getProcessingConfiguration(processorLambda: lambda.Function | undefined, processingType?: string): any {
        if (processorLambda) {
            return {
                enabled: true,
                processors: [{
                    type: 'Lambda',
                    parameters: [{
                        parameterName: 'LambdaArn',
                        parameterValue: processorLambda.functionArn
                    }]
                }]
            };
        }

        if (this.shouldCreateProcessor(processingType || '')) {
            // Fallback: disable processing if Lambda should exist but wasn't created
            return { enabled: false };
        }

        // Default processing for services that don't need custom Lambda
        return {
            enabled: true,
            processors: [{
                type: 'MetadataExtraction',
                parameters: [{
                    parameterName: 'MetadataExtractionQuery',
                    parameterValue: '{timestamp: now, service_type: "' + (processingType || 'unknown') + '"}'
                }, {
                    parameterName: 'JsonParsingEngine',
                    parameterValue: 'JQ-1.6'
                }]
            }]
        };
    }
}