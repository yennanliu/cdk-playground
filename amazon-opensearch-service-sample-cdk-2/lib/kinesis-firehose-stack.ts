// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps, RemovalPolicy, Duration, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { StackPropsExt } from './stack-composer';

export interface KinesisFirehoseStackProps extends StackPropsExt {
    readonly opensearchDomain: opensearch.Domain;
    readonly opensearchIndex: string;
    readonly opensearchStackName: string;
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

        // Create Kinesis Firehose
        const deliveryStream = new firehose.CfnDeliveryStream(this, `${this.stackName}-OpenSearchDeliveryStream`, {
            deliveryStreamName: `${this.stackName}-${props.opensearchIndex}-stream`,
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
                processingConfiguration: {
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
                    },
                    compressionFormat: 'UNCOMPRESSED'
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
    }
} 