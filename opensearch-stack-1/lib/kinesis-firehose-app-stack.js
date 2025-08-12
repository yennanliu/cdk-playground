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
exports.KinesisFirehoseAppStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const firehose = __importStar(require("aws-cdk-lib/aws-kinesisfirehose"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
class KinesisFirehoseAppStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { appTypeConfig } = props;
        // Create S3 bucket for Firehose backup
        const backupBucket = new s3.Bucket(this, `${this.stackName}-FirehoseBackupBucket`, {
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        // Import the Firehose role ARN from the OpenSearch stack
        const firehoseRoleArn = aws_cdk_lib_1.Fn.importValue(`${props.opensearchStackName}-FirehoseRoleArn`);
        const firehoseRole = iam.Role.fromRoleArn(this, 'ImportedFirehoseRole', firehoseRoleArn, {
            // Ensure the role is mutable for additional permissions
            mutable: true
        });
        // Grant the imported role permissions to write to this stack's S3 bucket
        backupBucket.grantReadWrite(firehoseRole);
        // Create Lambda function for processing CloudWatch Logs data based on app type
        // Package the entire lambda directory to include shared modules
        const processorLambda = new lambda.Function(this, `${this.stackName}-LogProcessor`, {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: `app-processors/${appTypeConfig.transformationModule}/index.handler`,
            code: lambda.Code.fromAsset('lambda'),
            timeout: aws_cdk_lib_1.Duration.minutes(5),
            memorySize: 512,
            description: `${appTypeConfig.appType} logs processor for CloudWatch Logs data to Firehose`,
            environment: {
                APP_TYPE: appTypeConfig.appType,
                TRANSFORMATION_MODULE: appTypeConfig.transformationModule
            }
        });
        // Grant Firehose permission to invoke the Lambda function
        processorLambda.grantInvoke(firehoseRole);
        // Create OpenSearch index name based on app type
        const opensearchIndex = `${appTypeConfig.appType}-logs`;
        // Create Kinesis Firehose with unique naming based on app type and domain
        const domainName = props.opensearchDomain.domainName.replace(/[^a-zA-Z0-9-]/g, '');
        const uniqueSuffix = this.node.addr.substring(0, 8);
        const deliveryStream = new firehose.CfnDeliveryStream(this, `${this.stackName}-OpenSearchDeliveryStream`, {
            deliveryStreamName: `${appTypeConfig.appType}-${domainName}-${this.stackName.substring(0, 20)}`.substring(0, 64),
            deliveryStreamType: 'DirectPut',
            amazonopensearchserviceDestinationConfiguration: {
                indexName: opensearchIndex,
                domainArn: props.opensearchDomain.domainArn,
                roleArn: firehoseRole.roleArn,
                indexRotationPeriod: 'NoRotation',
                bufferingHints: {
                    intervalInSeconds: 60,
                    sizeInMBs: 1
                },
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: `/aws/kinesisfirehose/${domainName}-${appTypeConfig.appType}-${uniqueSuffix}`,
                    logStreamName: `${domainName}-${appTypeConfig.appType}-Delivery`
                },
                processingConfiguration: {
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
                },
                s3BackupMode: 'FailedDocumentsOnly',
                s3Configuration: {
                    bucketArn: backupBucket.bucketArn,
                    roleArn: firehoseRole.roleArn,
                    bufferingHints: {
                        intervalInSeconds: 60,
                        sizeInMBs: 1
                    }
                },
                retryOptions: {
                    durationInSeconds: 300
                }
            }
        });
        // Ensure delivery stream waits for all role permissions to be set
        deliveryStream.node.addDependency(processorLambda);
        // Create CloudWatch Logs for Firehose operations
        const logGroup = new aws_logs_1.LogGroup(this, `${this.stackName}-FirehoseLogGroup`, {
            logGroupName: `/aws/firehose/${domainName}-${appTypeConfig.appType}-${uniqueSuffix}`,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
        });
        // Import the CloudWatch Logs role ARN from the OpenSearch stack
        const cloudwatchLogsRoleArn = aws_cdk_lib_1.Fn.importValue(`${props.opensearchStackName}-CloudWatchLogsRoleArn`);
        // Create CloudWatch Logs destination
        const logsDestination = new logs.CfnDestination(this, `${this.stackName}-LogsDestination`, {
            destinationName: `${domainName}-${appTypeConfig.appType}-${uniqueSuffix}-dest`,
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
                        Resource: `arn:aws:logs:${this.region}:${this.account}:destination:${this.stackName}-${appTypeConfig.appType}-firehose-destination`
                    }]
            })
        });
        // Ensure destination is created after the delivery stream
        logsDestination.addDependency(deliveryStream);
        // Create subscription filters for each log group in the app type configuration
        appTypeConfig.logGroups.forEach((logGroupName, index) => {
            const subscriptionFilter = new logs.CfnSubscriptionFilter(this, `${this.stackName}-LogsSubscriptionFilter-${index}`, {
                logGroupName: logGroupName,
                destinationArn: deliveryStream.attrArn,
                roleArn: cloudwatchLogsRoleArn,
                filterPattern: '', // Empty filter pattern means all log events
                filterName: `${domainName}-${appTypeConfig.appType}-${uniqueSuffix}-filter-${index}`
            });
            // Ensure the subscription filter is created after the delivery stream
            subscriptionFilter.addDependency(deliveryStream);
            subscriptionFilter.addDependency(logsDestination);
        });
        // Export the delivery stream ARN for reference
        this.exportValue(deliveryStream.attrArn, {
            name: `${this.stackName}-DeliveryStreamArn`,
            description: `Delivery stream ARN for ${appTypeConfig.appType} logs`
        });
    }
}
exports.KinesisFirehoseAppStack = KinesisFirehoseAppStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2luZXNpcy1maXJlaG9zZS1hcHAtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJraW5lc2lzLWZpcmVob3NlLWFwcC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDZDQUE2RTtBQUU3RSwwRUFBNEQ7QUFDNUQseURBQTJDO0FBQzNDLDJEQUE2QztBQUM3Qyx1REFBeUM7QUFFekMsK0RBQWlEO0FBQ2pELG1EQUFnRDtBQVVoRCxNQUFhLHVCQUF3QixTQUFRLG1CQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUM7UUFDekUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLGFBQWEsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUVoQyx1Q0FBdUM7UUFDdkMsTUFBTSxZQUFZLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLHVCQUF1QixFQUFFO1lBQy9FLGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87WUFDcEMsaUJBQWlCLEVBQUUsSUFBSTtTQUMxQixDQUFDLENBQUM7UUFFSCx5REFBeUQ7UUFDekQsTUFBTSxlQUFlLEdBQUcsZ0JBQUUsQ0FBQyxXQUFXLENBQUMsR0FBRyxLQUFLLENBQUMsbUJBQW1CLGtCQUFrQixDQUFDLENBQUM7UUFDdkYsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFLGVBQWUsRUFBRTtZQUNyRix3REFBd0Q7WUFDeEQsT0FBTyxFQUFFLElBQUk7U0FDaEIsQ0FBQyxDQUFDO1FBRUgseUVBQXlFO1FBQ3pFLFlBQVksQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFMUMsK0VBQStFO1FBQy9FLGdFQUFnRTtRQUNoRSxNQUFNLGVB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O3FCQUN0SSxDQUFDO2FBQ0wsQ0FBQztTQUNMLENBQUMsQ0FBQztRQUVILDBEQUEwRDtRQUMxRCxlQUFlLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRTlDLCtFQUErRTtRQUMvRSxhQUFhLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLFlBQVksRUFBRSxLQUFLLEVBQUUsRUFBRTtZQUNwRCxNQUFNLGtCQUFrQixHQUFHLElBQUksSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLDJCQUEyQixLQUFLLEVBQUUsRUFBRTtnQkFDakgsWUFBWSxFQUFFLFlBQVk7Z0JBQzFCLGNBQWMsRUFBRSxjQUFjLENBQUMsT0FBTztnQkFDdEMsT0FBTyxFQUFFLHFCQUFxQjtnQkFDOUIsYUFBYSxFQUFFLEVBQUUsRUFBRSw0Q0FBNEM7Z0JBQy9ELFVBQVUsRUFBRSxHQUFHLFVBQVUsSUFBSSxhQUFhLENBQUMsT0FBTyxJQUFJLFlBQVksV0FBVyxLQUFLLEVBQUU7YUFDdkYsQ0FBQyxDQUFDO1lBRUgsc0VBQXNFO1lBQ3RFLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQztZQUNqRCxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDdEQsQ0FBQyxDQUFDLENBQUM7UUFFSCwrQ0FBK0M7UUFDL0MsSUFBSSxDQUFDLFdBQVcsQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFO1lBQ3JDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLG9CQUFvQjtZQUMzQyxXQUFXLEVBQUUsMkJBQTJCLGFBQWEsQ0FBQyxPQUFPLE9BQU87U0FDdkUsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBbkpELDBEQW1KQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBTdGFja1Byb3BzLCBSZW1vdmFsUG9saWN5LCBEdXJhdGlvbiwgRm4gfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGZpcmVob3NlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1raW5lc2lzZmlyZWhvc2UnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgb3BlbnNlYXJjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtb3BlbnNlYXJjaHNlcnZpY2UnO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgTG9nR3JvdXAgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBTdGFja1Byb3BzRXh0IH0gZnJvbSAnLi9zdGFjay1jb21wb3Nlcic7XG5pbXBvcnQgeyBBcHBUeXBlQ29uZmlnIH0gZnJvbSAnLi9jb25maWcvdHlwZXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEtpbmVzaXNGaXJlaG9zZUFwcFN0YWNrUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzRXh0IHtcbiAgICByZWFkb25seSBvcGVuc2VhcmNoRG9tYWluOiBvcGVuc2VhcmNoLkRvbWFpbjtcbiAgICByZWFkb25seSBvcGVuc2VhcmNoU3RhY2tOYW1lOiBzdHJpbmc7XG4gICAgcmVhZG9ubHkgYXBwVHlwZUNvbmZpZzogQXBwVHlwZUNvbmZpZztcbn1cblxuZXhwb3J0IGNsYXNzIEtpbmVzaXNGaXJlaG9zZUFwcFN0YWNrIGV4dGVuZHMgU3RhY2sge1xuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBLaW5lc2lzRmlyZWhvc2VBcHBTdGFja1Byb3BzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgICAgIGNvbnN0IHsgYXBwVHlwZUNvbmZpZyB9ID0gcHJvcHM7XG5cbiAgICAgICAgLy8gQ3JlYXRlIFMzIGJ1Y2tldCBmb3IgRmlyZWhvc2UgYmFja3VwXG4gICAgICAgIGNvbnN0IGJhY2t1cEJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgYCR7dGhpcy5zdGFja05hbWV9LUZpcmVob3NlQmFja3VwQnVja2V0YCwge1xuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEltcG9ydCB0aGUgRmlyZWhvc2Ugcm9sZSBBUk4gZnJvbSB0aGUgT3BlblNlYXJjaCBzdGFja1xuICAgICAgICBjb25zdCBmaXJlaG9zZVJvbGVBcm4gPSBGbi5pbXBvcnRWYWx1ZShgJHtwcm9wcy5vcGVuc2VhcmNoU3RhY2tOYW1lfS1GaXJlaG9zZVJvbGVBcm5gKTtcbiAgICAgICAgY29uc3QgZmlyZWhvc2VSb2xlID0gaWFtLlJvbGUuZnJvbVJvbGVBcm4odGhpcywgJ0ltcG9ydGVkRmlyZWhvc2VSb2xlJywgZmlyZWhvc2VSb2xlQXJuLCB7XG4gICAgICAgICAgICAvLyBFbnN1cmUgdGhlIHJvbGUgaXMgbXV0YWJsZSBmb3IgYWRkaXRpb25hbCBwZXJtaXNzaW9uc1xuICAgICAgICAgICAgbXV0YWJsZTogdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBHcmFudCB0aGUgaW1wb3J0ZWQgcm9sZSBwZXJtaXNzaW9ucyB0byB3cml0ZSB0byB0aGlzIHN0YWNrJ3MgUzMgYnVja2V0XG4gICAgICAgIGJhY2t1cEJ1Y2tldC5ncmFudFJlYWRXcml0ZShmaXJlaG9zZVJvbGUpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBMYW1iZGEgZnVuY3Rpb24gZm9yIHByb2Nlc3NpbmcgQ2xvdWRXYXRjaCBMb2dzIGRhdGEgYmFzZWQgb24gYXBwIHR5cGVcbiAgICAgICAgLy8gUGFja2FnZSB0aGUgZW50aXJlIGxhbWJkYSBkaXJlY3RvcnkgdG8gaW5jbHVkZSBzaGFyZWQgbW9kdWxlc1xuICAgICAgICBjb25zdCBwcm9jZXNzb3JMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGAke3RoaXMuc3RhY2tOYW1lfS1Mb2dQcm9jZXNzb3JgLCB7XG4gICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgICAgICAgIGhhbmRsZXI6IGBhcHAtcHJvY2Vzc29ycy8ke2FwcFR5cGVDb25maWcudHJhbnNmb3JtYXRpb25Nb2R1bGV9L2luZGV4LmhhbmRsZXJgLFxuICAgICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogYCR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfSBsb2dzIHByb2Nlc3NvciBmb3IgQ2xvdWRXYXRjaCBMb2dzIGRhdGEgdG8gRmlyZWhvc2VgLFxuICAgICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICAgICBBUFBfVFlQRTogYXBwVHlwZUNvbmZpZy5hcHBUeXBlLFxuICAgICAgICAgICAgICAgIFRSQU5TRk9STUFUSU9OX01PRFVMRTogYXBwVHlwZUNvbmZpZy50cmFuc2Zvcm1hdGlvbk1vZHVsZVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBHcmFudCBGaXJlaG9zZSBwZXJtaXNzaW9uIHRvIGludm9rZSB0aGUgTGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgIHByb2Nlc3NvckxhbWJkYS5ncmFudEludm9rZShmaXJlaG9zZVJvbGUpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBPcGVuU2VhcmNoIGluZGV4IG5hbWUgYmFzZWQgb24gYXBwIHR5cGVcbiAgICAgICAgY29uc3Qgb3BlbnNlYXJjaEluZGV4ID0gYCR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfS1sb2dzYDtcblxuICAgICAgICAvLyBDcmVhdGUgS2luZXNpcyBGaXJlaG9zZSB3aXRoIHVuaXF1ZSBuYW1pbmcgYmFzZWQgb24gYXBwIHR5cGUgYW5kIGRvbWFpblxuICAgICAgICBjb25zdCBkb21haW5OYW1lID0gcHJvcHMub3BlbnNlYXJjaERvbWFpbi5kb21haW5OYW1lLnJlcGxhY2UoL1teYS16QS1aMC05LV0vZywgJycpO1xuICAgICAgICBjb25zdCB1bmlxdWVTdWZmaXggPSB0aGlzLm5vZGUuYWRkci5zdWJzdHJpbmcoMCwgOCk7XG4gICAgICAgIGNvbnN0IGRlbGl2ZXJ5U3RyZWFtID0gbmV3IGZpcmVob3NlLkNmbkRlbGl2ZXJ5U3RyZWFtKHRoaXMsIGAke3RoaXMuc3RhY2tOYW1lfS1PcGVuU2VhcmNoRGVsaXZlcnlTdHJlYW1gLCB7XG4gICAgICAgICAgICBkZWxpdmVyeVN0cmVhbU5hbWU6IGAke2FwcFR5cGVDb25maWcuYXBwVHlwZX0tJHtkb21haW5OYW1lfS0ke3RoaXMuc3RhY2tOYW1lLnN1YnN0cmluZygwLCAyMCl9YC5zdWJzdHJpbmcoMCwgNjQpLFxuICAgICAgICAgICAgZGVsaXZlcnlTdHJlYW1UeXBlOiAnRGlyZWN0UHV0JyxcbiAgICAgICAgICAgIGFtYXpvbm9wZW5zZWFyY2hzZXJ2aWNlRGVzdGluYXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiBvcGVuc2VhcmNoSW5kZXgsXG4gICAgICAgICAgICAgICAgZG9tYWluQXJuOiBwcm9wcy5vcGVuc2VhcmNoRG9tYWluLmRvbWFpbkFybixcbiAgICAgICAgICAgICAgICByb2xlQXJuOiBmaXJlaG9zZVJvbGUucm9sZUFybixcbiAgICAgICAgICAgICAgICBpbmRleFJvdGF0aW9uUGVyaW9kOiAnTm9Sb3RhdGlvbicsXG4gICAgICAgICAgICAgICAgYnVmZmVyaW5nSGludHM6IHtcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJ2YWxJblNlY29uZHM6IDYwLFxuICAgICAgICAgICAgICAgICAgICBzaXplSW5NQnM6IDFcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGNsb3VkV2F0Y2hMb2dnaW5nT3B0aW9uczoge1xuICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2tpbmVzaXNmaXJlaG9zZS8ke2RvbWFpbk5hbWV9LSR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfS0ke3VuaXF1ZVN1ZmZpeH1gLFxuICAgICAgICAgICAgICAgICAgICBsb2dTdHJlYW1OYW1lOiBgJHtkb21haW5OYW1lfS0ke2FwcFR5cGVDb25maWcuYXBwVHlwZX0tRGVsaXZlcnlgXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwcm9jZXNzaW5nQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzb3JzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ0xhbWJkYScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyYW1ldGVyczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJOYW1lOiAnTGFtYmRhQXJuJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmFtZXRlclZhbHVlOiBwcm9jZXNzb3JMYW1iZGEuZnVuY3Rpb25Bcm5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgczNCYWNrdXBNb2RlOiAnRmFpbGVkRG9jdW1lbnRzT25seScsXG4gICAgICAgICAgICAgICAgczNDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgIGJ1Y2tldEFybjogYmFja3VwQnVja2V0LmJ1Y2tldEFybixcbiAgICAgICAgICAgICAgICAgICAgcm9sZUFybjogZmlyZWhvc2VSb2xlLnJvbGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIGJ1ZmZlcmluZ0hpbnRzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnRlcnZhbEluU2Vjb25kczogNjAsXG4gICAgICAgICAgICAgICAgICAgICAgICBzaXplSW5NQnM6IDFcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmV0cnlPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uSW5TZWNvbmRzOiAzMDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEVuc3VyZSBkZWxpdmVyeSBzdHJlYW0gd2FpdHMgZm9yIGFsbCByb2xlIHBlcm1pc3Npb25zIHRvIGJlIHNldFxuICAgICAgICBkZWxpdmVyeVN0cmVhbS5ub2RlLmFkZERlcGVuZGVuY3kocHJvY2Vzc29yTGFtYmRhKTtcblxuICAgICAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBMb2dzIGZvciBGaXJlaG9zZSBvcGVyYXRpb25zXG4gICAgICAgIGNvbnN0IGxvZ0dyb3VwID0gbmV3IExvZ0dyb3VwKHRoaXMsIGAke3RoaXMuc3RhY2tOYW1lfS1GaXJlaG9zZUxvZ0dyb3VwYCwge1xuICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9maXJlaG9zZS8ke2RvbWFpbk5hbWV9LSR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfS0ke3VuaXF1ZVN1ZmZpeH1gLFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEltcG9ydCB0aGUgQ2xvdWRXYXRjaCBMb2dzIHJvbGUgQVJOIGZyb20gdGhlIE9wZW5TZWFyY2ggc3RhY2tcbiAgICAgICAgY29uc3QgY2xvdWR3YXRjaExvZ3NSb2xlQXJuID0gRm4uaW1wb3J0VmFsdWUoYCR7cHJvcHMub3BlbnNlYXJjaFN0YWNrTmFtZX0tQ2xvdWRXYXRjaExvZ3NSb2xlQXJuYCk7XG4gICAgICAgIFxuICAgICAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBMb2dzIGRlc3RpbmF0aW9uXG4gICAgICAgIGNvbnN0IGxvZ3NEZXN0aW5hdGlvbiA9IG5ldyBsb2dzLkNmbkRlc3RpbmF0aW9uKHRoaXMsIGAke3RoaXMuc3RhY2tOYW1lfS1Mb2dzRGVzdGluYXRpb25gLCB7XG4gICAgICAgICAgICBkZXN0aW5hdGlvbk5hbWU6IGAke2RvbWFpbk5hbWV9LSR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfS0ke3VuaXF1ZVN1ZmZpeH0tZGVzdGAsXG4gICAgICAgICAgICB0YXJnZXRBcm46IGRlbGl2ZXJ5U3RyZWFtLmF0dHJBcm4sXG4gICAgICAgICAgICByb2xlQXJuOiBjbG91ZHdhdGNoTG9nc1JvbGVBcm4sXG4gICAgICAgICAgICBkZXN0aW5hdGlvblBvbGljeTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgICAgICAgICAgICAgICBTdGF0ZW1lbnQ6IFt7XG4gICAgICAgICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgICAgICAgUHJpbmNpcGFsOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBBV1M6IHRoaXMuYWNjb3VudFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBBY3Rpb246ICdsb2dzOlB1dFN1YnNjcmlwdGlvbkZpbHRlcicsXG4gICAgICAgICAgICAgICAgICAgIFJlc291cmNlOiBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpkZXN0aW5hdGlvbjoke3RoaXMuc3RhY2tOYW1lfS0ke2FwcFR5cGVDb25maWcuYXBwVHlwZX0tZmlyZWhvc2UtZGVzdGluYXRpb25gXG4gICAgICAgICAgICAgICAgfV1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEVuc3VyZSBkZXN0aW5hdGlvbiBpcyBjcmVhdGVkIGFmdGVyIHRoZSBkZWxpdmVyeSBzdHJlYW1cbiAgICAgICAgbG9nc0Rlc3RpbmF0aW9uLmFkZERlcGVuZGVuY3koZGVsaXZlcnlTdHJlYW0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBzdWJzY3JpcHRpb24gZmlsdGVycyBmb3IgZWFjaCBsb2cgZ3JvdXAgaW4gdGhlIGFwcCB0eXBlIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgYXBwVHlwZUNvbmZpZy5sb2dHcm91cHMuZm9yRWFjaCgobG9nR3JvdXBOYW1lLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3Vic2NyaXB0aW9uRmlsdGVyID0gbmV3IGxvZ3MuQ2ZuU3Vic2NyaXB0aW9uRmlsdGVyKHRoaXMsIGAke3RoaXMuc3RhY2tOYW1lfS1Mb2dzU3Vic2NyaXB0aW9uRmlsdGVyLSR7aW5kZXh9YCwge1xuICAgICAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogbG9nR3JvdXBOYW1lLFxuICAgICAgICAgICAgICAgIGRlc3RpbmF0aW9uQXJuOiBkZWxpdmVyeVN0cmVhbS5hdHRyQXJuLFxuICAgICAgICAgICAgICAgIHJvbGVBcm46IGNsb3Vkd2F0Y2hMb2dzUm9sZUFybixcbiAgICAgICAgICAgICAgICBmaWx0ZXJQYXR0ZXJuOiAnJywgLy8gRW1wdHkgZmlsdGVyIHBhdHRlcm4gbWVhbnMgYWxsIGxvZyBldmVudHNcbiAgICAgICAgICAgICAgICBmaWx0ZXJOYW1lOiBgJHtkb21haW5OYW1lfS0ke2FwcFR5cGVDb25maWcuYXBwVHlwZX0tJHt1bmlxdWVTdWZmaXh9LWZpbHRlci0ke2luZGV4fWBcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBFbnN1cmUgdGhlIHN1YnNjcmlwdGlvbiBmaWx0ZXIgaXMgY3JlYXRlZCBhZnRlciB0aGUgZGVsaXZlcnkgc3RyZWFtXG4gICAgICAgICAgICBzdWJzY3JpcHRpb25GaWx0ZXIuYWRkRGVwZW5kZW5jeShkZWxpdmVyeVN0cmVhbSk7XG4gICAgICAgICAgICBzdWJzY3JpcHRpb25GaWx0ZXIuYWRkRGVwZW5kZW5jeShsb2dzRGVzdGluYXRpb24pO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBFeHBvcnQgdGhlIGRlbGl2ZXJ5IHN0cmVhbSBBUk4gZm9yIHJlZmVyZW5jZVxuICAgICAgICB0aGlzLmV4cG9ydFZhbHVlKGRlbGl2ZXJ5U3RyZWFtLmF0dHJBcm4sIHtcbiAgICAgICAgICAgIG5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1EZWxpdmVyeVN0cmVhbUFybmAsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogYERlbGl2ZXJ5IHN0cmVhbSBBUk4gZm9yICR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfSBsb2dzYFxuICAgICAgICB9KTtcbiAgICB9XG59Il19