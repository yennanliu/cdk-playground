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
    readonly eksLogGroupName?: string;  // Optional EKS log group name for subscription filter
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
        if (props.opensearchIndex === 'eks-logs') {
            processorLambda = new lambda.Function(this, `${this.stackName}-LogProcessor`, {
                runtime: lambda.Runtime.NODEJS_18_X,
                handler: 'index.handler',
                code: lambda.Code.fromAsset('lambda/firehose-processor'),
                timeout: Duration.minutes(5),
                memorySize: 512,
                description: 'Processes and decompresses EKS CloudWatch Logs data for Firehose'
            });

            // Grant Firehose permission to invoke the Lambda function
            processorLambda.grantInvoke(firehoseRole);
        } else if (props.opensearchIndex === 'pod-logs') {
            processorLambda = new lambda.Function(this, `${this.stackName}-LogProcessor`, {
                runtime: lambda.Runtime.NODEJS_18_X,
                handler: 'index.handler',
                code: lambda.Code.fromAsset('lambda/pod-logs-processor'),
                timeout: Duration.minutes(5),
                memorySize: 512,
                description: 'Processes and decompresses Pod CloudWatch Logs data for Firehose'
            });

            // Grant Firehose permission to invoke the Lambda function
            processorLambda.grantInvoke(firehoseRole);
        }

        // Create Kinesis Firehose
        const deliveryStream = new firehose.CfnDeliveryStream(this, `${this.stackName}-OpenSearchDeliveryStream`, {
            deliveryStreamName: `${props.opensearchIndex}-${this.stackName.substring(0, 40)}`.substring(0, 64),
            deliveryStreamType: 'DirectPut',
            amazonopensearchserviceDestinationConfiguration: {
                indexName: props.opensearchIndex,
                domainArn: props.opensearchDomain.domainArn,
                roleArn: firehoseRole.roleArn,
                indexRotationPeriod: 'NoRotation',  // Prevent date-based indices
                bufferingHints: {
                    intervalInSeconds: 60,  // Standard buffering interval
                    sizeInMBs: 5  // Increased buffer size for better performance
                },
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: `/aws/kinesisfirehose/${this.stackName}-${props.opensearchIndex}`,
                    logStreamName: `${this.stackName}-OpenSearchDelivery`
                },
                processingConfiguration: (props.opensearchIndex === 'eks-logs' || props.opensearchIndex === 'pod-logs') && processorLambda ? {
                    enabled: true,
                    processors: [
                        {
                            type: 'Lambda',
                            parameters: [
                                {
                                    parameterName: 'LambdaArn',
                                    parameterValue: processorLambda.functionArn
                                }
                            ]
                        }
                    ]
                } : (props.opensearchIndex === 'eks-logs' || props.opensearchIndex === 'pod-logs') ? {
                    enabled: false  // Fallback: disable processing if Lambda not created
                } : {
                    enabled: true,
                    processors: [
                        {
                            type: 'MetadataExtraction',
                            parameters: [
                                {
                                    parameterName: 'MetadataExtractionQuery',
                                    parameterValue: '{symbol: .TICKER_SYMBOL, sector: .SECTOR, price_change: .CHANGE, current_price: .PRICE, timestamp: now}'
                                },
                                {
                                    parameterName: 'JsonParsingEngine',
                                    parameterValue: 'JQ-1.6'
                                }
                            ]
                        }
                    ]
                },
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
            logGroupName: `/aws/firehose/${this.stackName}-${props.opensearchIndex}`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        // Create CloudWatch Logs destination for easier management (for eks-logs and pod-logs)
        if (props.opensearchIndex === 'eks-logs' || props.opensearchIndex === 'pod-logs') {
            // Import the CloudWatch Logs role ARN from the OpenSearch stack
            const cloudwatchLogsRoleArn = Fn.importValue(`${props.opensearchStackName}-CloudWatchLogsRoleArn`);
            
            // Create CloudWatch Logs destination
            const logsDestination = new logs.CfnDestination(this, `${this.stackName}-LogsDestination`, {
                destinationName: `${this.stackName}-${props.opensearchIndex}-firehose-destination`,
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

            // Add CloudWatch Logs subscription filter for EKS logs (if specified)
            if (props.eksLogGroupName) {
                try {
                    // Create subscription filter to send EKS logs to Firehose
                    const subscriptionFilter = new logs.CfnSubscriptionFilter(this, `${this.stackName}-LogsSubscriptionFilter`, {
                        logGroupName: props.eksLogGroupName,
                        destinationArn: deliveryStream.attrArn,
                        roleArn: cloudwatchLogsRoleArn,
                        filterPattern: '', // Empty filter pattern means all log events
                        filterName: `${this.stackName}-logs-to-firehose`
                    });

                    // Ensure the subscription filter is created after the delivery stream
                    subscriptionFilter.addDependency(deliveryStream);
                } catch (error) {
                    console.warn(`Could not create subscription filter for log group ${props.eksLogGroupName}: ${error}`);
                }
            }
        }
    }
}