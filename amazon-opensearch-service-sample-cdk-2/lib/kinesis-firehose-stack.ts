// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps, RemovalPolicy, Duration, PhysicalName } from 'aws-cdk-lib';
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
  readonly firehoseRole?: iam.Role;
}

export class KinesisFirehoseStack extends Stack {
  public readonly firehoseRole: iam.Role;

  constructor(scope: Construct, id: string, props: KinesisFirehoseStackProps) {
    super(scope, id, props);

    // Create S3 bucket for Firehose backup
    const backupBucket = new s3.Bucket(this, 'FirehoseBackupBucket', {
      bucketName: PhysicalName.GENERATE_IF_NEEDED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Use provided role or create new one
    const firehoseRole = props.firehoseRole || new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    this.firehoseRole = firehoseRole;

    // Grant permissions to access OpenSearch
    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'es:DescribeElasticsearchDomain',
        'es:DescribeElasticsearchDomains',
        'es:DescribeElasticsearchDomainConfig',
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpGet',
        'opensearch:DescribeDomain',
        'opensearch:DescribeDomains',
        'opensearch:DescribeDomainConfig',
        'opensearch:ESHttpPost',
        'opensearch:ESHttpPut',
        'opensearch:ESHttpGet',
      ],
      resources: [
        props.opensearchDomain.domainArn,
        `${props.opensearchDomain.domainArn}/*`,
      ],
    }));

    // Grant permissions to write to CloudWatch Logs
    firehoseRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:PutLogEvents',
        'logs:CreateLogStream',
        'logs:CreateLogGroup',
        'logs:DescribeLogStreams',
        'logs:DescribeLogGroups',
      ],
      resources: ['*'],
    }));

    // Grant permissions to write to S3 bucket
    backupBucket.grantReadWrite(firehoseRole);


    // Create Kinesis Firehose
    const deliveryStream = new firehose.CfnDeliveryStream(this, 'OpenSearchDeliveryStream', {
      deliveryStreamName: `${props.opensearchIndex}-stream`,
      deliveryStreamType: 'DirectPut',
      elasticsearchDestinationConfiguration: {
        indexName: props.opensearchIndex,
        domainArn: props.opensearchDomain.domainArn,
        roleArn: firehoseRole.roleArn,
        bufferingHints: {
          intervalInSeconds: 60,
          sizeInMBs: 1
        },
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: `/aws/firehose/${props.opensearchIndex}`,
          logStreamName: 'OpenSearchDelivery'
        },
        processingConfiguration: {
          enabled: false
        },
        s3BackupMode: 'AllDocuments',
        s3Configuration: {
          bucketArn: backupBucket.bucketArn,
          roleArn: firehoseRole.roleArn,
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 1
          },
          compressionFormat: 'UNCOMPRESSED',
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