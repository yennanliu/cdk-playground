import { Construct } from 'constructs';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { OpenSearchConstruct } from './opensearch';
import { BedrockEmbeddingsConstruct } from './bedrock-embeddings';

export interface FirehoseConstructProps {
  readonly deliveryStreamName: string;
  readonly openSearchConstruct: OpenSearchConstruct;
  readonly bedrockEmbeddings: BedrockEmbeddingsConstruct;
  readonly indexName: string;
  readonly vectorFieldName: string;
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

    // Create S3 backup bucket
    this.backupBucket = new s3.Bucket(this, 'BackupBucket', {
      removalPolicy: props.removalPolicy || RemovalPolicy.DESTROY,
      autoDeleteObjects: props.removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(7),
        },
      ],
    });

    // Create CloudWatch log group for Firehose
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      removalPolicy: props.removalPolicy || RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const logStream = new logs.LogStream(this, 'LogStream', {
      logGroup,
      removalPolicy: props.removalPolicy || RemovalPolicy.DESTROY,
    });

    // Create IAM role for Firehose
    this.deliveryRole = new iam.Role(this, 'DeliveryRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });

    // Grant permissions to Firehose
    this.backupBucket.grantWrite(this.deliveryRole);
    logGroup.grantWrite(this.deliveryRole);
    props.openSearchConstruct.grantWrite(this.deliveryRole);
    props.bedrockEmbeddings.embedFunction.grantInvoke(this.deliveryRole);

    // Create Lambda processor for transforming data and getting embeddings
    const processor = new lambda.Function(this, 'Processor', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/firehose-processor', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install --no-cache -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: {
        EMBEDDINGS_FUNCTION_ARN: props.bedrockEmbeddings.embedFunction.functionArn,
        VECTOR_FIELD_NAME: props.vectorFieldName,
      },
    });

    // Grant permissions to processor Lambda
    props.bedrockEmbeddings.embedFunction.grantInvoke(processor);

    // Create Firehose delivery stream
    this.deliveryStream = new kinesisfirehose.CfnDeliveryStream(this, 'DeliveryStream', {
      deliveryStreamName: props.deliveryStreamName,
      deliveryStreamType: 'DirectPut',
      
      amazonopensearchserviceDestinationConfiguration: {
        indexName: props.indexName,
        domainArn: props.openSearchConstruct.collectionArn,
        roleArn: this.deliveryRole.roleArn,
        
        bufferingHints: {
          intervalInSeconds: props.bufferInterval?.toSeconds() || 60,
          sizeInMBs: props.bufferSize || 5,
        },
        
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: logGroup.logGroupName,
          logStreamName: logStream.logStreamName,
        },
        
        processingConfiguration: {
          enabled: true,
          processors: [
            {
              type: 'Lambda',
              parameters: [
                {
                  parameterName: 'LambdaArn',
                  parameterValue: processor.functionArn,
                },
                {
                  parameterName: 'BufferSizeInMBs',
                  parameterValue: '3',
                },
                {
                  parameterName: 'BufferIntervalInSeconds',
                  parameterValue: '60',
                },
              ],
            },
          ],
        },
        
        s3BackupMode: 'FailedDocumentsOnly',
        s3Configuration: {
          bucketArn: this.backupBucket.bucketArn,
          roleArn: this.deliveryRole.roleArn,
          prefix: props.backupBucketPrefix,
          bufferingHints: {
            intervalInSeconds: 300,
            sizeInMBs: 5,
          },
          cloudWatchLoggingOptions: {
            enabled: true,
            logGroupName: logGroup.logGroupName,
            logStreamName: logStream.logStreamName,
          },
        },
      },
    });
  }
}