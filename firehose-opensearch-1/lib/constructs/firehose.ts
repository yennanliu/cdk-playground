import { Construct } from 'constructs';
import * as kinesisfirehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { OpenSearchConstruct } from './opensearch';

export interface FirehoseConstructProps {
  readonly deliveryStreamName: string;
  readonly openSearchConstruct: OpenSearchConstruct;
  readonly indexName?: string;
  readonly bufferInterval?: Duration;
  readonly bufferSize?: number;
  readonly backupBucketPrefix?: string;
  readonly removalPolicy?: RemovalPolicy;
}

export class FirehoseConstruct extends Construct {
  public readonly deliveryStream: kinesisfirehose.CfnDeliveryStream;
  public readonly backupBucket: s3.Bucket;
  public readonly deliveryRole: iam.Role;

  constructor(scope: Construct, id: string, props: FirehoseConstructProps) {
    super(scope, id);

    // Create S3 bucket for backup and failed records
    this.backupBucket = new s3.Bucket(this, 'BackupBucket', {
      removalPolicy: props.removalPolicy || RemovalPolicy.DESTROY,
      autoDeleteObjects: props.removalPolicy === RemovalPolicy.DESTROY,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Create CloudWatch log group for Firehose
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/kinesisfirehose/${props.deliveryStreamName}`,
      removalPolicy: props.removalPolicy || RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const logStream = new logs.LogStream(this, 'LogStream', {
      logGroup,
      logStreamName: 'delivery',
    });

    // Create IAM role for Firehose
    this.deliveryRole = new iam.Role(this, 'DeliveryRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      description: 'IAM role for Kinesis Firehose delivery to OpenSearch',
    });

    // Grant permissions to write to S3 backup bucket
    this.backupBucket.grantReadWrite(this.deliveryRole);

    // Grant permissions to write to CloudWatch Logs
    this.deliveryRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:PutLogEvents',
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
        ],
        resources: [logGroup.logGroupArn],
      })
    );

    // Grant permissions to access OpenSearch
    props.openSearchConstruct.grantWrite(this.deliveryRole);
    
    // Additional OpenSearch permissions for Firehose
    this.deliveryRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'es:DescribeDomain',
          'es:DescribeDomains',
          'es:DescribeDomainConfig',
          'es:ESHttpPost',
          'es:ESHttpPut',
        ],
        resources: [
          props.openSearchConstruct.domainArn,
          `${props.openSearchConstruct.domainArn}/*`,
        ],
      })
    );

    // Create the Kinesis Firehose delivery stream
    this.deliveryStream = new kinesisfirehose.CfnDeliveryStream(this, 'DeliveryStream', {
      deliveryStreamName: props.deliveryStreamName,
      deliveryStreamType: 'DirectPut',
      
      amazonopensearchserviceDestinationConfiguration: {
        domainArn: props.openSearchConstruct.domainArn,
        indexName: props.indexName || 'firehose-index',
        roleArn: this.deliveryRole.roleArn,
        
        // Buffering configuration
        bufferingHints: {
          intervalInSeconds: props.bufferInterval?.toSeconds() || 60,
          sizeInMBs: props.bufferSize || 5,
        },

        // Backup configuration
        s3Configuration: {
          bucketArn: this.backupBucket.bucketArn,
          prefix: props.backupBucketPrefix || 'backup/',
          errorOutputPrefix: 'errors/',
          roleArn: this.deliveryRole.roleArn,
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 5,
          },
          compressionFormat: 'GZIP',
        },

        // OpenSearch specific configuration
        typeName: '_doc',

        // CloudWatch logging
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: logGroup.logGroupName,
          logStreamName: logStream.logStreamName,
        },

        // Processing configuration
        processingConfiguration: {
          enabled: false,
        },
      },
    });
  }

  /**
   * Grant permissions to put records to the Firehose delivery stream
   */
  public grantPutRecords(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'firehose:PutRecord',
        'firehose:PutRecordBatch',
      ],
      resourceArns: [this.deliveryStream.attrArn],
    });
  }

  /**
   * Grant permissions to describe the Firehose delivery stream
   */
  public grantDescribe(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'firehose:DescribeDeliveryStream',
      ],
      resourceArns: [this.deliveryStream.attrArn],
    });
  }
}