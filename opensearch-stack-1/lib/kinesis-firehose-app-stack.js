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
        const lambdaPath = `lambda/app-processors/${appTypeConfig.transformationModule}`;
        const processorLambda = new lambda.Function(this, `${this.stackName}-LogProcessor`, {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(lambdaPath),
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
            try {
                const subscriptionFilter = new logs.CfnSubscriptionFilter(this, `${this.stackName}-LogsSubscriptionFilter-${index}`, {
                    logGroupName: logGroupName,
                    destinationArn: deliveryStream.attrArn,
                    roleArn: cloudwatchLogsRoleArn,
                    filterPattern: '', // Empty filter pattern means all log events
                    filterName: `${domainName}-${appTypeConfig.appType}-${uniqueSuffix}-filter-${index}`
                });
                // Ensure the subscription filter is created after the delivery stream
                subscriptionFilter.addDependency(deliveryStream);
            }
            catch (error) {
                console.warn(`Could not create subscription filter for log group ${logGroupName}: ${error}`);
            }
        });
        // Export the delivery stream ARN for reference
        this.exportValue(deliveryStream.attrArn, {
            name: `${this.stackName}-DeliveryStreamArn`,
            description: `Delivery stream ARN for ${appTypeConfig.appType} logs`
        });
    }
}
exports.KinesisFirehoseAppStack = KinesisFirehoseAppStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2luZXNpcy1maXJlaG9zZS1hcHAtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJraW5lc2lzLWZpcmVob3NlLWFwcC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDZDQUE2RTtBQUU3RSwwRUFBNEQ7QUFDNUQseURBQTJDO0FBQzNDLDJEQUE2QztBQUM3Qyx1REFBeUM7QUFFekMsK0RBQWlEO0FBQ2pELG1EQUFnRDtBQVVoRCxNQUFhLHVCQUF3QixTQUFRLG1CQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUM7UUFDekUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLGFBQWEsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUVoQyx1Q0FBdUM7UUFDdkMsTUFBTSxZQUFZLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLHVCQUF1QixFQUFFO1lBQy9FLGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87WUFDcEMsaUJBQWlCLEVBQUUsSUFBSTtTQUMxQixDQUFDLENBQUM7UUFFSCx5REFBeUQ7UUFDekQsTUFBTSxlQUFlLEdBQUcsZ0JBQUUsQ0FBQyxXQUFXLENBQUMsR0FBRyxLQUFLLENBQUMsbUJBQW1CLGtCQUFrQixDQUFDLENBQUM7UUFDdkYsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFLGVBQWUsRUFBRTtZQUNyRix3REFBd0Q7WUFDeEQsT0FBTyxFQUFFLElBQUk7U0FDaEIsQ0FBQyxDQUFDO1FBRUgseUVBQXlFO1FBQ3pFLFlBQVksQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFMUMsK0VBQStFO1FBQy9FLE1BQU0sVUFBVSxHQUFHLHlCQUF5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aW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMsIFJlbW92YWxQb2xpY3ksIER1cmF0aW9uLCBGbiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZmlyZWhvc2UgZnJvbSAnYXdzLWNkay1saWIvYXdzLWtpbmVzaXNmaXJlaG9zZSc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBvcGVuc2VhcmNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1vcGVuc2VhcmNoc2VydmljZSc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBMb2dHcm91cCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IFN0YWNrUHJvcHNFeHQgfSBmcm9tICcuL3N0YWNrLWNvbXBvc2VyJztcbmltcG9ydCB7IEFwcFR5cGVDb25maWcgfSBmcm9tICcuL2NvbmZpZy90eXBlcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgS2luZXNpc0ZpcmVob3NlQXBwU3RhY2tQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHNFeHQge1xuICAgIHJlYWRvbmx5IG9wZW5zZWFyY2hEb21haW46IG9wZW5zZWFyY2guRG9tYWluO1xuICAgIHJlYWRvbmx5IG9wZW5zZWFyY2hTdGFja05hbWU6IHN0cmluZztcbiAgICByZWFkb25seSBhcHBUeXBlQ29uZmlnOiBBcHBUeXBlQ29uZmlnO1xufVxuXG5leHBvcnQgY2xhc3MgS2luZXNpc0ZpcmVob3NlQXBwU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEtpbmVzaXNGaXJlaG9zZUFwcFN0YWNrUHJvcHMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAgICAgY29uc3QgeyBhcHBUeXBlQ29uZmlnIH0gPSBwcm9wcztcblxuICAgICAgICAvLyBDcmVhdGUgUzMgYnVja2V0IGZvciBGaXJlaG9zZSBiYWNrdXBcbiAgICAgICAgY29uc3QgYmFja3VwQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCBgJHt0aGlzLnN0YWNrTmFtZX0tRmlyZWhvc2VCYWNrdXBCdWNrZXRgLCB7XG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSW1wb3J0IHRoZSBGaXJlaG9zZSByb2xlIEFSTiBmcm9tIHRoZSBPcGVuU2VhcmNoIHN0YWNrXG4gICAgICAgIGNvbnN0IGZpcmVob3NlUm9sZUFybiA9IEZuLmltcG9ydFZhbHVlKGAke3Byb3BzLm9wZW5zZWFyY2hTdGFja05hbWV9LUZpcmVob3NlUm9sZUFybmApO1xuICAgICAgICBjb25zdCBmaXJlaG9zZVJvbGUgPSBpYW0uUm9sZS5mcm9tUm9sZUFybih0aGlzLCAnSW1wb3J0ZWRGaXJlaG9zZVJvbGUnLCBmaXJlaG9zZVJvbGVBcm4sIHtcbiAgICAgICAgICAgIC8vIEVuc3VyZSB0aGUgcm9sZSBpcyBtdXRhYmxlIGZvciBhZGRpdGlvbmFsIHBlcm1pc3Npb25zXG4gICAgICAgICAgICBtdXRhYmxlOiB0cnVlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEdyYW50IHRoZSBpbXBvcnRlZCByb2xlIHBlcm1pc3Npb25zIHRvIHdyaXRlIHRvIHRoaXMgc3RhY2sncyBTMyBidWNrZXRcbiAgICAgICAgYmFja3VwQnVja2V0LmdyYW50UmVhZFdyaXRlKGZpcmVob3NlUm9sZSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbiBmb3IgcHJvY2Vzc2luZyBDbG91ZFdhdGNoIExvZ3MgZGF0YSBiYXNlZCBvbiBhcHAgdHlwZVxuICAgICAgICBjb25zdCBsYW1iZGFQYXRoID0gYGxhbWJkYS9hcHAtcHJvY2Vzc29ycy8ke2FwcFR5cGVDb25maWcudHJhbnNmb3JtYXRpb25Nb2R1bGV9YDtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHByb2Nlc3NvckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYCR7dGhpcy5zdGFja05hbWV9LUxvZ1Byb2Nlc3NvcmAsIHtcbiAgICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGxhbWJkYVBhdGgpLFxuICAgICAgICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgJHthcHBUeXBlQ29uZmlnLmFwcFR5cGV9IGxvZ3MgcHJvY2Vzc29yIGZvciBDbG91ZFdhdGNoIExvZ3MgZGF0YSB0byBGaXJlaG9zZWAsXG4gICAgICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgIEFQUF9UWVBFOiBhcHBUeXBlQ29uZmlnLmFwcFR5cGUsXG4gICAgICAgICAgICAgICAgVFJBTlNGT1JNQVRJT05fTU9EVUxFOiBhcHBUeXBlQ29uZmlnLnRyYW5zZm9ybWF0aW9uTW9kdWxlXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEdyYW50IEZpcmVob3NlIHBlcm1pc3Npb24gdG8gaW52b2tlIHRoZSBMYW1iZGEgZnVuY3Rpb25cbiAgICAgICAgcHJvY2Vzc29yTGFtYmRhLmdyYW50SW52b2tlKGZpcmVob3NlUm9sZSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggaW5kZXggbmFtZSBiYXNlZCBvbiBhcHAgdHlwZVxuICAgICAgICBjb25zdCBvcGVuc2VhcmNoSW5kZXggPSBgJHthcHBUeXBlQ29uZmlnLmFwcFR5cGV9LWxvZ3NgO1xuXG4gICAgICAgIC8vIENyZWF0ZSBLaW5lc2lzIEZpcmVob3NlIHdpdGggdW5pcXVlIG5hbWluZyBiYXNlZCBvbiBhcHAgdHlwZSBhbmQgZG9tYWluXG4gICAgICAgIGNvbnN0IGRvbWFpbk5hbWUgPSBwcm9wcy5vcGVuc2VhcmNoRG9tYWluLmRvbWFpbk5hbWUucmVwbGFjZSgvW15hLXpBLVowLTktXS9nLCAnJyk7XG4gICAgICAgIGNvbnN0IHVuaXF1ZVN1ZmZpeCA9IHRoaXMubm9kZS5hZGRyLnN1YnN0cmluZygwLCA4KTtcbiAgICAgICAgY29uc3QgZGVsaXZlcnlTdHJlYW0gPSBuZXcgZmlyZWhvc2UuQ2ZuRGVsaXZlcnlTdHJlYW0odGhpcywgYCR7dGhpcy5zdGFja05hbWV9LU9wZW5TZWFyY2hEZWxpdmVyeVN0cmVhbWAsIHtcbiAgICAgICAgICAgIGRlbGl2ZXJ5U3RyZWFtTmFtZTogYCR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfS0ke2RvbWFpbk5hbWV9LSR7dGhpcy5zdGFja05hbWUuc3Vic3RyaW5nKDAsIDIwKX1gLnN1YnN0cmluZygwLCA2NCksXG4gICAgICAgICAgICBkZWxpdmVyeVN0cmVhbVR5cGU6ICdEaXJlY3RQdXQnLFxuICAgICAgICAgICAgYW1hem9ub3BlbnNlYXJjaHNlcnZpY2VEZXN0aW5hdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6IG9wZW5zZWFyY2hJbmRleCxcbiAgICAgICAgICAgICAgICBkb21haW5Bcm46IHByb3BzLm9wZW5zZWFyY2hEb21haW4uZG9tYWluQXJuLFxuICAgICAgICAgICAgICAgIHJvbGVBcm46IGZpcmVob3NlUm9sZS5yb2xlQXJuLFxuICAgICAgICAgICAgICAgIGluZGV4Um90YXRpb25QZXJpb2Q6ICdOb1JvdGF0aW9uJyxcbiAgICAgICAgICAgICAgICBidWZmZXJpbmdIaW50czoge1xuICAgICAgICAgICAgICAgICAgICBpbnRlcnZhbEluU2Vjb25kczogNjAsXG4gICAgICAgICAgICAgICAgICAgIHNpemVJbk1CczogMVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgY2xvdWRXYXRjaExvZ2dpbmdPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3Mva2luZXNpc2ZpcmVob3NlLyR7ZG9tYWluTmFtZX0tJHthcHBUeXBlQ29uZmlnLmFwcFR5cGV9LSR7dW5pcXVlU3VmZml4fWAsXG4gICAgICAgICAgICAgICAgICAgIGxvZ1N0cmVhbU5hbWU6IGAke2RvbWFpbk5hbWV9LSR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfS1EZWxpdmVyeWBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHByb2Nlc3NpbmdDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NvcnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnTGFtYmRhJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmFtZXRlck5hbWU6ICdMYW1iZGFBcm4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyYW1ldGVyVmFsdWU6IHByb2Nlc3NvckxhbWJkYS5mdW5jdGlvbkFyblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzM0JhY2t1cE1vZGU6ICdGYWlsZWREb2N1bWVudHNPbmx5JyxcbiAgICAgICAgICAgICAgICBzM0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgYnVja2V0QXJuOiBiYWNrdXBCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgICAgICAgICAgICAgICByb2xlQXJuOiBmaXJlaG9zZVJvbGUucm9sZUFybixcbiAgICAgICAgICAgICAgICAgICAgYnVmZmVyaW5nSGludHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGludGVydmFsSW5TZWNvbmRzOiA2MCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNpemVJbk1CczogMVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZXRyeU9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICAgICAgZHVyYXRpb25JblNlY29uZHM6IDMwMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRW5zdXJlIGRlbGl2ZXJ5IHN0cmVhbSB3YWl0cyBmb3IgYWxsIHJvbGUgcGVybWlzc2lvbnMgdG8gYmUgc2V0XG4gICAgICAgIGRlbGl2ZXJ5U3RyZWFtLm5vZGUuYWRkRGVwZW5kZW5jeShwcm9jZXNzb3JMYW1iZGEpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIExvZ3MgZm9yIEZpcmVob3NlIG9wZXJhdGlvbnNcbiAgICAgICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcywgYCR7dGhpcy5zdGFja05hbWV9LUZpcmVob3NlTG9nR3JvdXBgLCB7XG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2ZpcmVob3NlLyR7ZG9tYWluTmFtZX0tJHthcHBUeXBlQ29uZmlnLmFwcFR5cGV9LSR7dW5pcXVlU3VmZml4fWAsXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSW1wb3J0IHRoZSBDbG91ZFdhdGNoIExvZ3Mgcm9sZSBBUk4gZnJvbSB0aGUgT3BlblNlYXJjaCBzdGFja1xuICAgICAgICBjb25zdCBjbG91ZHdhdGNoTG9nc1JvbGVBcm4gPSBGbi5pbXBvcnRWYWx1ZShgJHtwcm9wcy5vcGVuc2VhcmNoU3RhY2tOYW1lfS1DbG91ZFdhdGNoTG9nc1JvbGVBcm5gKTtcbiAgICAgICAgXG4gICAgICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIExvZ3MgZGVzdGluYXRpb25cbiAgICAgICAgY29uc3QgbG9nc0Rlc3RpbmF0aW9uID0gbmV3IGxvZ3MuQ2ZuRGVzdGluYXRpb24odGhpcywgYCR7dGhpcy5zdGFja05hbWV9LUxvZ3NEZXN0aW5hdGlvbmAsIHtcbiAgICAgICAgICAgIGRlc3RpbmF0aW9uTmFtZTogYCR7ZG9tYWluTmFtZX0tJHthcHBUeXBlQ29uZmlnLmFwcFR5cGV9LSR7dW5pcXVlU3VmZml4fS1kZXN0YCxcbiAgICAgICAgICAgIHRhcmdldEFybjogZGVsaXZlcnlTdHJlYW0uYXR0ckFybixcbiAgICAgICAgICAgIHJvbGVBcm46IGNsb3Vkd2F0Y2hMb2dzUm9sZUFybixcbiAgICAgICAgICAgIGRlc3RpbmF0aW9uUG9saWN5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgICAgICAgICAgIFN0YXRlbWVudDogW3tcbiAgICAgICAgICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgICAgICAgICBQcmluY2lwYWw6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEFXUzogdGhpcy5hY2NvdW50XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIEFjdGlvbjogJ2xvZ3M6UHV0U3Vic2NyaXB0aW9uRmlsdGVyJyxcbiAgICAgICAgICAgICAgICAgICAgUmVzb3VyY2U6IGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmRlc3RpbmF0aW9uOiR7dGhpcy5zdGFja05hbWV9LSR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfS1maXJlaG9zZS1kZXN0aW5hdGlvbmBcbiAgICAgICAgICAgICAgICB9XVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRW5zdXJlIGRlc3RpbmF0aW9uIGlzIGNyZWF0ZWQgYWZ0ZXIgdGhlIGRlbGl2ZXJ5IHN0cmVhbVxuICAgICAgICBsb2dzRGVzdGluYXRpb24uYWRkRGVwZW5kZW5jeShkZWxpdmVyeVN0cmVhbSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIHN1YnNjcmlwdGlvbiBmaWx0ZXJzIGZvciBlYWNoIGxvZyBncm91cCBpbiB0aGUgYXBwIHR5cGUgY29uZmlndXJhdGlvblxuICAgICAgICBhcHBUeXBlQ29uZmlnLmxvZ0dyb3Vwcy5mb3JFYWNoKChsb2dHcm91cE5hbWUsIGluZGV4KSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN1YnNjcmlwdGlvbkZpbHRlciA9IG5ldyBsb2dzLkNmblN1YnNjcmlwdGlvbkZpbHRlcih0aGlzLCBgJHt0aGlzLnN0YWNrTmFtZX0tTG9nc1N1YnNjcmlwdGlvbkZpbHRlci0ke2luZGV4fWAsIHtcbiAgICAgICAgICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBsb2dHcm91cE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGRlc3RpbmF0aW9uQXJuOiBkZWxpdmVyeVN0cmVhbS5hdHRyQXJuLFxuICAgICAgICAgICAgICAgICAgICByb2xlQXJuOiBjbG91ZHdhdGNoTG9nc1JvbGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIGZpbHRlclBhdHRlcm46ICcnLCAvLyBFbXB0eSBmaWx0ZXIgcGF0dGVybiBtZWFucyBhbGwgbG9nIGV2ZW50c1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJOYW1lOiBgJHtkb21haW5OYW1lfS0ke2FwcFR5cGVDb25maWcuYXBwVHlwZX0tJHt1bmlxdWVTdWZmaXh9LWZpbHRlci0ke2luZGV4fWBcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB0aGUgc3Vic2NyaXB0aW9uIGZpbHRlciBpcyBjcmVhdGVkIGFmdGVyIHRoZSBkZWxpdmVyeSBzdHJlYW1cbiAgICAgICAgICAgICAgICBzdWJzY3JpcHRpb25GaWx0ZXIuYWRkRGVwZW5kZW5jeShkZWxpdmVyeVN0cmVhbSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgQ291bGQgbm90IGNyZWF0ZSBzdWJzY3JpcHRpb24gZmlsdGVyIGZvciBsb2cgZ3JvdXAgJHtsb2dHcm91cE5hbWV9OiAke2Vycm9yfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBFeHBvcnQgdGhlIGRlbGl2ZXJ5IHN0cmVhbSBBUk4gZm9yIHJlZmVyZW5jZVxuICAgICAgICB0aGlzLmV4cG9ydFZhbHVlKGRlbGl2ZXJ5U3RyZWFtLmF0dHJBcm4sIHtcbiAgICAgICAgICAgIG5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1EZWxpdmVyeVN0cmVhbUFybmAsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogYERlbGl2ZXJ5IHN0cmVhbSBBUk4gZm9yICR7YXBwVHlwZUNvbmZpZy5hcHBUeXBlfSBsb2dzYFxuICAgICAgICB9KTtcbiAgICB9XG59Il19