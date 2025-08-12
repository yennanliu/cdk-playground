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
import { AppTypeConfig } from './config/types';

export interface KinesisFirehoseAppStackProps extends StackPropsExt {
    readonly opensearchDomain: opensearch.Domain;
    readonly opensearchStackName: string;
    readonly appTypeConfig: AppTypeConfig;
}

export class KinesisFirehoseAppStack extends Stack {
    constructor(scope: Construct, id: string, props: KinesisFirehoseAppStackProps) {
        super(scope, id, props);

        const { appTypeConfig } = props;

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

        // Create Lambda function for processing CloudWatch Logs data based on app type
        const lambdaPath = `lambda/app-processors/${appTypeConfig.transformationModule}`;
        
        const processorLambda = new lambda.Function(this, `${this.stackName}-LogProcessor`, {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(lambdaPath),
            timeout: Duration.minutes(5),
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

        // Create CloudWatch Logs for Firehose operations
        const logGroup = new LogGroup(this, `${this.stackName}-FirehoseLogGroup`, {
            logGroupName: `/aws/firehose/${domainName}-${appTypeConfig.appType}-${uniqueSuffix}`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        // Import the CloudWatch Logs role ARN from the OpenSearch stack
        const cloudwatchLogsRoleArn = Fn.importValue(`${props.opensearchStackName}-CloudWatchLogsRoleArn`);
        
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
            } catch (error) {
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