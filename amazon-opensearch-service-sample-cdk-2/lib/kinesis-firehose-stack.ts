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
        const backupBucket = new s3.Bucket(this, 'FirehoseBackupBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Import the Firehose role ARN from the OpenSearch stack
        const firehoseRoleArn = Fn.importValue(`${props.opensearchStackName}-FirehoseRoleArn`);
        const firehoseRole = iam.Role.fromRoleArn(this, 'ImportedFirehoseRole', firehoseRoleArn);

        // Grant the imported role permissions to write to this stack's S3 bucket
        backupBucket.grantReadWrite(firehoseRole);

        // Create Kinesis Firehose
        const deliveryStream = new firehose.CfnDeliveryStream(this, 'OpenSearchDeliveryStream', {
            deliveryStreamName: `${props.opensearchIndex}-stream`,
            deliveryStreamType: 'DirectPut',
            amazonopensearchserviceDestinationConfiguration: {
                indexName: props.opensearchIndex,
                domainArn: props.opensearchDomain.domainArn,
                roleArn: firehoseRole.roleArn,
                bufferingHints: {
                    intervalInSeconds: 3,  // Reduced from 60 to 3 seconds for faster debugging
                    sizeInMBs: 1
                },
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: `/aws/kinesisfirehose/${props.opensearchIndex}`,
                    logStreamName: 'OpenSearchDelivery'
                },
                processingConfiguration: {
                    enabled: true,
                    processors: [{
                        type: 'MetadataExtraction',
                        parameters: [{
                            parameterName: 'MetadataExtractionQuery',
                            parameterValue: '{timestamp:.time, message:.message}'
                        }, {
                            parameterName: 'JsonParsingEngine',
                            parameterValue: 'JQ-1.6'
                        }]
                    }]
                },
                s3BackupMode: 'AllDocuments',
                s3Configuration: {
                    bucketArn: backupBucket.bucketArn,
                    roleArn: firehoseRole.roleArn,
                    bufferingHints: {
                        intervalInSeconds: 3,  // Reduced from 60 to 3 seconds for faster debugging
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
        const logGroup = new LogGroup(this, 'FirehoseLogGroup', {
            logGroupName: `/aws/firehose/${props.opensearchIndex}`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
        });
    }
} 