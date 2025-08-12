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
exports.KinesisFirehoseStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const firehose = __importStar(require("aws-cdk-lib/aws-kinesisfirehose"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
class KinesisFirehoseStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create S3 bucket for Firehose backup
        const backupBucket = new s3.Bucket(this, `${this.stackName}-FirehoseBackupBucket`, {
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        // Import the Firehose role ARN from the OpenSearch stack
        const firehoseRoleArn = aws_cdk_lib_1.Fn.importValue(`${props.opensearchStackName}-FirehoseRoleArn`);
        const firehoseRole = iam.Role.fromRoleArn(this, 'ImportedFirehoseRole', firehoseRoleArn);
        // Grant the imported role permissions to write to this stack's S3 bucket
        backupBucket.grantReadWrite(firehoseRole);
        // Create Lambda function for processing CloudWatch Logs data based on index type
        let processorLambda;
        if (props.opensearchIndex === 'eks-logs' || props.opensearchIndex === 'pod-logs') {
            // Determine lambda directory and processing type based on index name
            const processingType = props.opensearchIndex === 'eks-logs' ? 'eks' : 'pod';
            const lambdaPath = props.opensearchIndex === 'eks-logs' ? 'lambda/firehose-processor' : 'lambda/pod-logs-processor';
            processorLambda = new lambda.Function(this, `${this.stackName}-LogProcessor`, {
                runtime: lambda.Runtime.NODEJS_18_X,
                handler: 'index.handler',
                code: lambda.Code.fromAsset(lambdaPath),
                timeout: aws_cdk_lib_1.Duration.minutes(5),
                memorySize: 512,
                description: `${processingType.toUpperCase()} logs processor for CloudWatch Logs data to Firehose`,
                environment: {
                    PROCESSING_TYPE: processingType,
                    LOG_TYPE: processingType
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
                indexRotationPeriod: 'NoRotation', // Prevent date-based indices
                bufferingHints: {
                    intervalInSeconds: 60, // Standard buffering interval
                    sizeInMBs: 1 // Smaller buffer for faster testing - documents will be delivered more frequently
                },
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: `/aws/kinesisfirehose/${domainName}-${props.opensearchIndex}-${uniqueSuffix}`,
                    logStreamName: `${domainName}-${props.opensearchIndex}-Delivery`
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
                    enabled: false // Fallback: disable processing if Lambda not created
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
                s3BackupMode: 'FailedDocumentsOnly', // Only backup failed deliveries
                s3Configuration: {
                    bucketArn: backupBucket.bucketArn,
                    roleArn: firehoseRole.roleArn,
                    bufferingHints: {
                        intervalInSeconds: 60, // S3 backup requires minimum 60 seconds
                        sizeInMBs: 1
                    }
                },
                retryOptions: {
                    durationInSeconds: 300
                }
            }
        });
        // Create CloudWatch Logs for Firehose operations (not for subscription)
        const logGroup = new aws_logs_1.LogGroup(this, `${this.stackName}-FirehoseLogGroup`, {
            logGroupName: `/aws/firehose/${domainName}-${props.opensearchIndex}-${uniqueSuffix}`,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
        });
        // Create CloudWatch Logs destination for easier management (for eks-logs and pod-logs)
        if (props.opensearchIndex === 'eks-logs' || props.opensearchIndex === 'pod-logs') {
            // Import the CloudWatch Logs role ARN from the OpenSearch stack
            const cloudwatchLogsRoleArn = aws_cdk_lib_1.Fn.importValue(`${props.opensearchStackName}-CloudWatchLogsRoleArn`);
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
            // Add CloudWatch Logs subscription filter for EKS logs (if specified)
            if (props.eksLogGroupName) {
                try {
                    // Create subscription filter to send EKS logs to Firehose
                    const subscriptionFilter = new logs.CfnSubscriptionFilter(this, `${this.stackName}-LogsSubscriptionFilter`, {
                        logGroupName: props.eksLogGroupName,
                        destinationArn: deliveryStream.attrArn,
                        roleArn: cloudwatchLogsRoleArn,
                        filterPattern: '', // Empty filter pattern means all log events
                        filterName: `${domainName}-${props.opensearchIndex}-${uniqueSuffix}-filter`
                    });
                    // Ensure the subscription filter is created after the delivery stream
                    subscriptionFilter.addDependency(deliveryStream);
                }
                catch (error) {
                    console.warn(`Could not create subscription filter for log group ${props.eksLogGroupName}: ${error}`);
                }
            }
        }
    }
}
exports.KinesisFirehoseStack = KinesisFirehoseStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2luZXNpcy1maXJlaG9zZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImtpbmVzaXMtZmlyZWhvc2Utc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw2Q0FBNkU7QUFFN0UsMEVBQTREO0FBQzVELHlEQUEyQztBQUMzQywyREFBNkM7QUFDN0MsdURBQXlDO0FBRXpDLCtEQUFpRDtBQUNqRCxtREFBZ0Q7QUFVaEQsTUFBYSxvQkFBcUIsU0FBUSxtQkFBSztJQUMzQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWdDO1FBQ3RFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHVDQUF1QztRQUN2QyxNQUFNLFlBQVksR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsdUJBQXVCLEVBQUU7WUFDL0UsYUFBYSxFQUFFLDJCQUFhLENBQUMsT0FBTztZQUNwQyxpQkFBaUIsRUFBRSxJQUFJO1NBQzFCLENBQUMsQ0FBQztRQUVILHlEQUF5RDtRQUN6RCxNQUFNLGVBQWUsR0FBRyxnQkFBRSxDQUFDLFdBQVcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxtQkFBbUIsa0JBQWtCLENBQUMsQ0FBQztRQUN2RixNQUFNLFlBQVksR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFFekYseUVBQXlFO1FBQ3pFLFlBQVksQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFMUMsaUZBQWlGO1FBQ2pGLElBQUksZUFBNEMsQ0FBQztRQUNqRCxJQUFJLEtBQUssQ0FBQyxlQUFlLEtBQUssVUFBVSxJQUFJLEtBQUssQ0FBQyxlQUFlLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDL0UscUVBQXFFO1lBQ3JFLE1BQU0sY0FBYyxHQUFHLEtBQUssQ0FBQyxlQUFlLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQztZQUM1RSxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsZUFBZSxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxDQUFDLDJCQUEyQixDQUFDO1lBRXBILGVBQWUsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsZUFBZSxFQUFFO2dCQUMxRSxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO2dCQUNuQyxPQUFPLEVBQUUsZUFBZTtnQkFDeEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQztnQkFDdkMsT0FBTyxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztnQkFDNUIsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsV0FBVyxFQUFFLEdBQUcsY0FBYyxDQUFDLFdBQVcsRUFBRSxzREFBc0Q7Z0JBQ2xHLFdBQVcsRUFBRTtvQkFDVCxlQUFlLEVBQUUsY0FBYztvQkFDL0IsUUFBUSxFQUFFLGNBQWM7aUJBQzNCO2FBQ0osQ0FBQyxDQUFDO1lBRUgsMERBQTBEO1lBQzFELGVBQWUsQ0FBQyxXQUFXLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDOUMsQ0FBQztRQUVELDZEQUE2RDtRQUM3RCxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNuRixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsOEJBQThCO1FBQ25GLE1BQU0sY0FBYyxHQUFHLElBQUksUUFBUSxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLDJCQUEyQixFQUFFO1lBQ3RHLGtCQUFrQixFQUFFLEdBQUcsS0FBSyxDQUFDLGVBQWUsSUFBSSxVQUFVLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDaEgsa0JBQWtCLEVBQUUsV0FBVztZQUMvQiwrQ0FBK0MsRUFBRTtnQkFDN0MsU0FBUyxFQUFFLEtBQUssQ0FBQyxlQUFlO2dCQUNoQyxTQUFTLEVBQUUsS0FBSyxDQUFDLGdCQUFnQixDQUFDLFNBQVM7Z0JBQzNDLE9BQU8sRUFBRSxZQUFZLENBQUMsT0FBTztnQkFDN0IsbUJBQW1CLEVBQUUsWUFBWSxFQUFHLDZCQUE2QjtnQkFDakUsY0FBYyxFQUFFO29CQUNaLGlCQUFpQixFQUFFLEVBQUUsRUFBRyw4QkFBOEI7b0JBQ3RELFNBQVMsRUFBRSxDQUFDLENBQUUsa0ZBQWtGO2lCQUNuRztnQkFDRCx3QkFBd0IsRUFBRTtvQkFDdEIsT0FBTyxFQUFFLElBQUk7b0JBQ2IsWUFBWSxFQUFFLHdCQUF3QixVQUFVLElBQUksS0FBSyxDQUFDLGVBQWUsSUFBSSxZQUFZLEVBQUU7b0JBQzNGLGFBQWEsRUFBRSxHQUFHLFVBQVUsSUFBSSxLQUFLLENBQUMsZUFBZSxXQUFXO2lCQUNuRTtnQkFDRCx1QkFBdUIsRUFBRSxDQUFDLEtBQUssQ0FBQyxlQUFlLEtBQUssVUFBVSxJQUFJLEtBQUssQ0FBQyxlQUFlLEtBQUssVUFBVSxDQUFDLElBQUksZUFBZSxDQUFDLENBQUMsQ0FBQztvQkFDekgsT0FBTyxFQUFFLElBQUk7b0JBQ2IsVUFBVSxFQUFFO3dCQUNSOzRCQUNJLElBQUksRUFBRSxRQUFROzRCQUNkLFVBQVUsRUFBRTtnQ0FDUjtvQ0FDSSxhQUFhLEVBQUUsV0FBVztvQ0FDMUIsY0FBYyxFQUFFLGVBQWUsQ0FBQyxXQUFXO2lDQUM5Qzs2QkFDSjt5QkFDSjtxQkFDSjtpQkFDSixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxlQUFlLEtBQUssVUFBVSxJQUFJLEtBQUssQ0FBQyxlQUFlLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUNqRixPQUFPLEVBQUUsS0FBSyxDQUFFLHFEQUFxRDtpQkFDeEUsQ0FBQyxDQUFDLENBQUM7b0JBQ0EsT0FBTyxFQUFFLElBQUk7b0JBQ2IsVUFBVSxFQUFFO3dCQUNSOzRCQUNJLElBQUksRUFBRSxvQkFBb0I7NEJBQzFCLFVBQVUsRUFBRTtnQ0FDUjtvQ0FDSSxhQUFhLEVBQUUseUJBQXlCO29DQUN4QyxjQUFjLEVBQUUseUdBQXlHO2lDQUM1SDtnQ0FDRDtvQ0FDSSxhQUFhLEVBQUUsbUJBQW1CO29DQUNsQyxjQUFjLEVBQUUsUUFBUTtpQ0FDM0I7NkJBQ0o7eUJBQ0o7cUJBQ0o7aUJBQ0o7Z0JBQ0QsWUFBWSxFQUFFLHFCQUFxQixFQUFHLGdDQUFnQztnQkFDdEUsZUFBZSxFQUFFO29CQUNiLFNBQVMsRUFBRSxZQUFZLENBQUMsU0FBUztvQkFDakMsT0FBTyxFQUFFLFlBQVksQ0FBQyxPQUFPO29CQUM3QixjQUFjLEVBQUU7d0JBQ1osaUJBQWlCLEVBQUUsRUFBRSxFQUFHLHdDQUF3Qzt3QkFDaEUsU0FBUyxFQUFFLENBQUM7cUJBQ2Y7aUJBQ0o7Z0JBQ0QsWUFBWSxFQUFFO29CQUNWLGlCQUFpQixFQUFFLEdBQUc7aUJBQ3pCO2FBQ0o7U0FDSixDQUFDLENBQUM7UUFFSCx3RUFBd0U7UUFDeEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxtQkFBUSxDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLG1CQUFtQixFQUFFO1lBQ3RFLFlBQVksRUFBRSxpQkFBaUIsVUFBVSxJQUFJLEtBQUssQ0FBQyxlQUFlLElBQUksWUFBWSxFQUFFO1lBQ3BGLGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87WUFDcEMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtTQUN6QyxDQUFDLENBQUM7UUFFSCx1RkFBdUY7UUFDdkYsSUFBSSxLQUFLLENBQUMsZUFBZSxLQUFLLFVBQVUsSUFBSSxLQUFLLENBQUMsZUFBZSxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQy9FLGdFQUFnRTtZQUNoRSxNQUFNLHFCQUFxQixHQUFHLGdCQUFFLENBQUMsV0FBVyxDQUFDLEdBQUcsS0FBSyxDQUFDLG1CQUFtQix3QkFBd0IsQ0FBQyxDQUFDO1lBRW5HLHFDQUFxQztZQUNyQyxNQUFNLGVBQWUsR0FBRyxJQUFJLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsa0JBQWtCLEVBQUU7Z0JBQ3ZGLGVBQWUsRUFBRSxHQUFHLFVBQVUsSUFBSSxLQUFLLENBQUMsZUFBZSxJQUFJLFlBQVksT0FBTztnQkFDOUUsU0FBUyxFQUFFLGNBQWMsQ0FBQyxPQUFPO2dCQUNqQyxPQUFPLEVBQUUscUJBQXFCO2dCQUM5QixpQkFBaUIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUM5QixPQUFPLEVBQUUsWUFBWTtvQkFDckIsU0FBUyxFQUFFLENBQUM7NEJBQ1IsTUFBTSxFQUFFLE9BQU87NEJBQ2YsU0FBUyxFQUFFO2dDQUNQLEdBQUcsRUFBRSxJQUFJLENBQUMsT0FBTzs2QkFDcEI7NEJBQ0QsTUFBTSxFQUFFLDRCQUE0Qjs0QkFDcEMsUUFBUSxFQUFFLGdCQUFnQixJQUFJLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLGdCQUFnQixJQUFJLENBQUMsU0FBUyxJQUFJLEtBQUssQ0FBQyxlQUFlLHVCQUF1Qjt5QkFDdEksQ0FBQztpQkFDTCxDQUFDO2FBQ0wsQ0FBQyxDQUFDO1lBRUgsMERBQTBEO1lBQzFELGVBQWUsQ0FBQyxhQUFhLENBQUMsY0FBYyxDQUFDLENBQUM7WUFFOUMsc0VBQXNFO1lBQ3RFLElBQUksS0FBSyxDQUFDLGVBQWUsRUFBRSxDQUFDO2dCQUN4QixJQUFJLENBQUM7b0JBQ0QsMERBQTBEO29CQUMxRCxNQUFNLGtCQUFrQixHQUFHLElBQUksSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLHlCQUF5QixFQUFFO3dCQUN4RyxZQUFZLEVBQUUsS0FBSyxDQUFDLGVBQWU7d0JBQ25DLGNBQWMsRUFBRSxjQUFjLENBQUMsT0FBTzt3QkFDdEMsT0FBTyxFQUFFLHFCQUFxQjt3QkFDOUIsYUFBYSxFQUFFLEVBQUUsRUFBRSw0Q0FBNEM7d0JBQy9ELFVBQVUsRUFBRSxHQUFHLFVBQVUsSUFBSSxLQUFLLENBQUMsZUFBZSxJQUFJLFlBQVksU0FBUztxQkFDOUUsQ0FBQyxDQUFDO29CQUVILHNFQUFzRTtvQkFDdEUsa0JBQWtCLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxDQUFDO2dCQUNyRCxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2IsT0FBTyxDQUFDLElBQUksQ0FBQyxzREFBc0QsS0FBSyxDQUFDLGVBQWUsS0FBSyxLQUFLLEVBQUUsQ0FBQyxDQUFDO2dCQUMxRyxDQUFDO1lBQ0wsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUFsS0Qsb0RBa0tDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMsIFJlbW92YWxQb2xpY3ksIER1cmF0aW9uLCBGbiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZmlyZWhvc2UgZnJvbSAnYXdzLWNkay1saWIvYXdzLWtpbmVzaXNmaXJlaG9zZSc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBvcGVuc2VhcmNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1vcGVuc2VhcmNoc2VydmljZSc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBMb2dHcm91cCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IFN0YWNrUHJvcHNFeHQgfSBmcm9tICcuL3N0YWNrLWNvbXBvc2VyJztcblxuZXhwb3J0IGludGVyZmFjZSBLaW5lc2lzRmlyZWhvc2VTdGFja1Byb3BzIGV4dGVuZHMgU3RhY2tQcm9wc0V4dCB7XG4gICAgcmVhZG9ubHkgb3BlbnNlYXJjaERvbWFpbjogb3BlbnNlYXJjaC5Eb21haW47XG4gICAgcmVhZG9ubHkgb3BlbnNlYXJjaEluZGV4OiBzdHJpbmc7XG4gICAgcmVhZG9ubHkgb3BlbnNlYXJjaFN0YWNrTmFtZTogc3RyaW5nO1xuICAgIHJlYWRvbmx5IGVrc0xvZ0dyb3VwTmFtZT86IHN0cmluZzsgIC8vIE9wdGlvbmFsIEVLUyBsb2cgZ3JvdXAgbmFtZSBmb3Igc3Vic2NyaXB0aW9uIGZpbHRlclxufVxuXG5leHBvcnQgY2xhc3MgS2luZXNpc0ZpcmVob3NlU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEtpbmVzaXNGaXJlaG9zZVN0YWNrUHJvcHMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIFMzIGJ1Y2tldCBmb3IgRmlyZWhvc2UgYmFja3VwXG4gICAgICAgIGNvbnN0IGJhY2t1cEJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgYCR7dGhpcy5zdGFja05hbWV9LUZpcmVob3NlQmFja3VwQnVja2V0YCwge1xuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEltcG9ydCB0aGUgRmlyZWhvc2Ugcm9sZSBBUk4gZnJvbSB0aGUgT3BlblNlYXJjaCBzdGFja1xuICAgICAgICBjb25zdCBmaXJlaG9zZVJvbGVBcm4gPSBGbi5pbXBvcnRWYWx1ZShgJHtwcm9wcy5vcGVuc2VhcmNoU3RhY2tOYW1lfS1GaXJlaG9zZVJvbGVBcm5gKTtcbiAgICAgICAgY29uc3QgZmlyZWhvc2VSb2xlID0gaWFtLlJvbGUuZnJvbVJvbGVBcm4odGhpcywgJ0ltcG9ydGVkRmlyZWhvc2VSb2xlJywgZmlyZWhvc2VSb2xlQXJuKTtcblxuICAgICAgICAvLyBHcmFudCB0aGUgaW1wb3J0ZWQgcm9sZSBwZXJtaXNzaW9ucyB0byB3cml0ZSB0byB0aGlzIHN0YWNrJ3MgUzMgYnVja2V0XG4gICAgICAgIGJhY2t1cEJ1Y2tldC5ncmFudFJlYWRXcml0ZShmaXJlaG9zZVJvbGUpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBMYW1iZGEgZnVuY3Rpb24gZm9yIHByb2Nlc3NpbmcgQ2xvdWRXYXRjaCBMb2dzIGRhdGEgYmFzZWQgb24gaW5kZXggdHlwZVxuICAgICAgICBsZXQgcHJvY2Vzc29yTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb24gfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChwcm9wcy5vcGVuc2VhcmNoSW5kZXggPT09ICdla3MtbG9ncycgfHwgcHJvcHMub3BlbnNlYXJjaEluZGV4ID09PSAncG9kLWxvZ3MnKSB7XG4gICAgICAgICAgICAvLyBEZXRlcm1pbmUgbGFtYmRhIGRpcmVjdG9yeSBhbmQgcHJvY2Vzc2luZyB0eXBlIGJhc2VkIG9uIGluZGV4IG5hbWVcbiAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NpbmdUeXBlID0gcHJvcHMub3BlbnNlYXJjaEluZGV4ID09PSAnZWtzLWxvZ3MnID8gJ2VrcycgOiAncG9kJztcbiAgICAgICAgICAgIGNvbnN0IGxhbWJkYVBhdGggPSBwcm9wcy5vcGVuc2VhcmNoSW5kZXggPT09ICdla3MtbG9ncycgPyAnbGFtYmRhL2ZpcmVob3NlLXByb2Nlc3NvcicgOiAnbGFtYmRhL3BvZC1sb2dzLXByb2Nlc3Nvcic7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHByb2Nlc3NvckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYCR7dGhpcy5zdGFja05hbWV9LUxvZ1Byb2Nlc3NvcmAsIHtcbiAgICAgICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgICAgICAgICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICAgICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGxhbWJkYVBhdGgpLFxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgJHtwcm9jZXNzaW5nVHlwZS50b1VwcGVyQ2FzZSgpfSBsb2dzIHByb2Nlc3NvciBmb3IgQ2xvdWRXYXRjaCBMb2dzIGRhdGEgdG8gRmlyZWhvc2VgLFxuICAgICAgICAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAgICAgICAgIFBST0NFU1NJTkdfVFlQRTogcHJvY2Vzc2luZ1R5cGUsXG4gICAgICAgICAgICAgICAgICAgIExPR19UWVBFOiBwcm9jZXNzaW5nVHlwZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBHcmFudCBGaXJlaG9zZSBwZXJtaXNzaW9uIHRvIGludm9rZSB0aGUgTGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgICAgICBwcm9jZXNzb3JMYW1iZGEuZ3JhbnRJbnZva2UoZmlyZWhvc2VSb2xlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBLaW5lc2lzIEZpcmVob3NlIHdpdGggdW5pcXVlIG5hbWluZyBiYXNlZCBvbiBkb21haW5cbiAgICAgICAgY29uc3QgZG9tYWluTmFtZSA9IHByb3BzLm9wZW5zZWFyY2hEb21haW4uZG9tYWluTmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOS1dL2csICcnKTtcbiAgICAgICAgY29uc3QgdW5pcXVlU3VmZml4ID0gdGhpcy5ub2RlLmFkZHIuc3Vic3RyaW5nKDAsIDgpOyAvLyBVc2UgdW5pcXVlIENESyBub2RlIGFkZHJlc3NcbiAgICAgICAgY29uc3QgZGVsaXZlcnlTdHJlYW0gPSBuZXcgZmlyZWhvc2UuQ2ZuRGVsaXZlcnlTdHJlYW0odGhpcywgYCR7dGhpcy5zdGFja05hbWV9LU9wZW5TZWFyY2hEZWxpdmVyeVN0cmVhbWAsIHtcbiAgICAgICAgICAgIGRlbGl2ZXJ5U3RyZWFtTmFtZTogYCR7cHJvcHMub3BlbnNlYXJjaEluZGV4fS0ke2RvbWFpbk5hbWV9LSR7dGhpcy5zdGFja05hbWUuc3Vic3RyaW5nKDAsIDIwKX1gLnN1YnN0cmluZygwLCA2NCksXG4gICAgICAgICAgICBkZWxpdmVyeVN0cmVhbVR5cGU6ICdEaXJlY3RQdXQnLFxuICAgICAgICAgICAgYW1hem9ub3BlbnNlYXJjaHNlcnZpY2VEZXN0aW5hdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6IHByb3BzLm9wZW5zZWFyY2hJbmRleCxcbiAgICAgICAgICAgICAgICBkb21haW5Bcm46IHByb3BzLm9wZW5zZWFyY2hEb21haW4uZG9tYWluQXJuLFxuICAgICAgICAgICAgICAgIHJvbGVBcm46IGZpcmVob3NlUm9sZS5yb2xlQXJuLFxuICAgICAgICAgICAgICAgIGluZGV4Um90YXRpb25QZXJpb2Q6ICdOb1JvdGF0aW9uJywgIC8vIFByZXZlbnQgZGF0ZS1iYXNlZCBpbmRpY2VzXG4gICAgICAgICAgICAgICAgYnVmZmVyaW5nSGludHM6IHtcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJ2YWxJblNlY29uZHM6IDYwLCAgLy8gU3RhbmRhcmQgYnVmZmVyaW5nIGludGVydmFsXG4gICAgICAgICAgICAgICAgICAgIHNpemVJbk1CczogMSAgLy8gU21hbGxlciBidWZmZXIgZm9yIGZhc3RlciB0ZXN0aW5nIC0gZG9jdW1lbnRzIHdpbGwgYmUgZGVsaXZlcmVkIG1vcmUgZnJlcXVlbnRseVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgY2xvdWRXYXRjaExvZ2dpbmdPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3Mva2luZXNpc2ZpcmVob3NlLyR7ZG9tYWluTmFtZX0tJHtwcm9wcy5vcGVuc2VhcmNoSW5kZXh9LSR7dW5pcXVlU3VmZml4fWAsXG4gICAgICAgICAgICAgICAgICAgIGxvZ1N0cmVhbU5hbWU6IGAke2RvbWFpbk5hbWV9LSR7cHJvcHMub3BlbnNlYXJjaEluZGV4fS1EZWxpdmVyeWBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHByb2Nlc3NpbmdDb25maWd1cmF0aW9uOiAocHJvcHMub3BlbnNlYXJjaEluZGV4ID09PSAnZWtzLWxvZ3MnIHx8IHByb3BzLm9wZW5zZWFyY2hJbmRleCA9PT0gJ3BvZC1sb2dzJykgJiYgcHJvY2Vzc29yTGFtYmRhID8ge1xuICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzb3JzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ0xhbWJkYScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyYW1ldGVyczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJOYW1lOiAnTGFtYmRhQXJuJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmFtZXRlclZhbHVlOiBwcm9jZXNzb3JMYW1iZGEuZnVuY3Rpb25Bcm5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH0gOiAocHJvcHMub3BlbnNlYXJjaEluZGV4ID09PSAnZWtzLWxvZ3MnIHx8IHByb3BzLm9wZW5zZWFyY2hJbmRleCA9PT0gJ3BvZC1sb2dzJykgPyB7XG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IGZhbHNlICAvLyBGYWxsYmFjazogZGlzYWJsZSBwcm9jZXNzaW5nIGlmIExhbWJkYSBub3QgY3JlYXRlZFxuICAgICAgICAgICAgICAgIH0gOiB7XG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NvcnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnTWV0YWRhdGFFeHRyYWN0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6ICdNZXRhZGF0YUV4dHJhY3Rpb25RdWVyeScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJWYWx1ZTogJ3tzeW1ib2w6IC5USUNLRVJfU1lNQk9MLCBzZWN0b3I6IC5TRUNUT1IsIHByaWNlX2NoYW5nZTogLkNIQU5HRSwgY3VycmVudF9wcmljZTogLlBSSUNFLCB0aW1lc3RhbXA6IG5vd30nXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6ICdKc29uUGFyc2luZ0VuZ2luZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJWYWx1ZTogJ0pRLTEuNidcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgczNCYWNrdXBNb2RlOiAnRmFpbGVkRG9jdW1lbnRzT25seScsICAvLyBPbmx5IGJhY2t1cCBmYWlsZWQgZGVsaXZlcmllc1xuICAgICAgICAgICAgICAgIHMzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICBidWNrZXRBcm46IGJhY2t1cEJ1Y2tldC5idWNrZXRBcm4sXG4gICAgICAgICAgICAgICAgICAgIHJvbGVBcm46IGZpcmVob3NlUm9sZS5yb2xlQXJuLFxuICAgICAgICAgICAgICAgICAgICBidWZmZXJpbmdIaW50czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW50ZXJ2YWxJblNlY29uZHM6IDYwLCAgLy8gUzMgYmFja3VwIHJlcXVpcmVzIG1pbmltdW0gNjAgc2Vjb25kc1xuICAgICAgICAgICAgICAgICAgICAgICAgc2l6ZUluTUJzOiAxXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJldHJ5T3B0aW9uczoge1xuICAgICAgICAgICAgICAgICAgICBkdXJhdGlvbkluU2Vjb25kczogMzAwXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBMb2dzIGZvciBGaXJlaG9zZSBvcGVyYXRpb25zIChub3QgZm9yIHN1YnNjcmlwdGlvbilcbiAgICAgICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcywgYCR7dGhpcy5zdGFja05hbWV9LUZpcmVob3NlTG9nR3JvdXBgLCB7XG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2ZpcmVob3NlLyR7ZG9tYWluTmFtZX0tJHtwcm9wcy5vcGVuc2VhcmNoSW5kZXh9LSR7dW5pcXVlU3VmZml4fWAsXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIENsb3VkV2F0Y2ggTG9ncyBkZXN0aW5hdGlvbiBmb3IgZWFzaWVyIG1hbmFnZW1lbnQgKGZvciBla3MtbG9ncyBhbmQgcG9kLWxvZ3MpXG4gICAgICAgIGlmIChwcm9wcy5vcGVuc2VhcmNoSW5kZXggPT09ICdla3MtbG9ncycgfHwgcHJvcHMub3BlbnNlYXJjaEluZGV4ID09PSAncG9kLWxvZ3MnKSB7XG4gICAgICAgICAgICAvLyBJbXBvcnQgdGhlIENsb3VkV2F0Y2ggTG9ncyByb2xlIEFSTiBmcm9tIHRoZSBPcGVuU2VhcmNoIHN0YWNrXG4gICAgICAgICAgICBjb25zdCBjbG91ZHdhdGNoTG9nc1JvbGVBcm4gPSBGbi5pbXBvcnRWYWx1ZShgJHtwcm9wcy5vcGVuc2VhcmNoU3RhY2tOYW1lfS1DbG91ZFdhdGNoTG9nc1JvbGVBcm5gKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIENsb3VkV2F0Y2ggTG9ncyBkZXN0aW5hdGlvblxuICAgICAgICAgICAgY29uc3QgbG9nc0Rlc3RpbmF0aW9uID0gbmV3IGxvZ3MuQ2ZuRGVzdGluYXRpb24odGhpcywgYCR7dGhpcy5zdGFja05hbWV9LUxvZ3NEZXN0aW5hdGlvbmAsIHtcbiAgICAgICAgICAgICAgICBkZXN0aW5hdGlvbk5hbWU6IGAke2RvbWFpbk5hbWV9LSR7cHJvcHMub3BlbnNlYXJjaEluZGV4fS0ke3VuaXF1ZVN1ZmZpeH0tZGVzdGAsXG4gICAgICAgICAgICAgICAgdGFyZ2V0QXJuOiBkZWxpdmVyeVN0cmVhbS5hdHRyQXJuLFxuICAgICAgICAgICAgICAgIHJvbGVBcm46IGNsb3Vkd2F0Y2hMb2dzUm9sZUFybixcbiAgICAgICAgICAgICAgICBkZXN0aW5hdGlvblBvbGljeTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICAgICAgICAgICAgICAgIFN0YXRlbWVudDogW3tcbiAgICAgICAgICAgICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIFByaW5jaXBhbDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFXUzogdGhpcy5hY2NvdW50XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgQWN0aW9uOiAnbG9nczpQdXRTdWJzY3JpcHRpb25GaWx0ZXInLFxuICAgICAgICAgICAgICAgICAgICAgICAgUmVzb3VyY2U6IGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmRlc3RpbmF0aW9uOiR7dGhpcy5zdGFja05hbWV9LSR7cHJvcHMub3BlbnNlYXJjaEluZGV4fS1maXJlaG9zZS1kZXN0aW5hdGlvbmBcbiAgICAgICAgICAgICAgICAgICAgfV1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEVuc3VyZSBkZXN0aW5hdGlvbiBpcyBjcmVhdGVkIGFmdGVyIHRoZSBkZWxpdmVyeSBzdHJlYW1cbiAgICAgICAgICAgIGxvZ3NEZXN0aW5hdGlvbi5hZGREZXBlbmRlbmN5KGRlbGl2ZXJ5U3RyZWFtKTtcblxuICAgICAgICAgICAgLy8gQWRkIENsb3VkV2F0Y2ggTG9ncyBzdWJzY3JpcHRpb24gZmlsdGVyIGZvciBFS1MgbG9ncyAoaWYgc3BlY2lmaWVkKVxuICAgICAgICAgICAgaWYgKHByb3BzLmVrc0xvZ0dyb3VwTmFtZSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBzdWJzY3JpcHRpb24gZmlsdGVyIHRvIHNlbmQgRUtTIGxvZ3MgdG8gRmlyZWhvc2VcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3Vic2NyaXB0aW9uRmlsdGVyID0gbmV3IGxvZ3MuQ2ZuU3Vic2NyaXB0aW9uRmlsdGVyKHRoaXMsIGAke3RoaXMuc3RhY2tOYW1lfS1Mb2dzU3Vic2NyaXB0aW9uRmlsdGVyYCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBwcm9wcy5la3NMb2dHcm91cE5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXN0aW5hdGlvbkFybjogZGVsaXZlcnlTdHJlYW0uYXR0ckFybixcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvbGVBcm46IGNsb3Vkd2F0Y2hMb2dzUm9sZUFybixcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbHRlclBhdHRlcm46ICcnLCAvLyBFbXB0eSBmaWx0ZXIgcGF0dGVybiBtZWFucyBhbGwgbG9nIGV2ZW50c1xuICAgICAgICAgICAgICAgICAgICAgICAgZmlsdGVyTmFtZTogYCR7ZG9tYWluTmFtZX0tJHtwcm9wcy5vcGVuc2VhcmNoSW5kZXh9LSR7dW5pcXVlU3VmZml4fS1maWx0ZXJgXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB0aGUgc3Vic2NyaXB0aW9uIGZpbHRlciBpcyBjcmVhdGVkIGFmdGVyIHRoZSBkZWxpdmVyeSBzdHJlYW1cbiAgICAgICAgICAgICAgICAgICAgc3Vic2NyaXB0aW9uRmlsdGVyLmFkZERlcGVuZGVuY3koZGVsaXZlcnlTdHJlYW0pO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgQ291bGQgbm90IGNyZWF0ZSBzdWJzY3JpcHRpb24gZmlsdGVyIGZvciBsb2cgZ3JvdXAgJHtwcm9wcy5la3NMb2dHcm91cE5hbWV9OiAke2Vycm9yfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0iXX0=