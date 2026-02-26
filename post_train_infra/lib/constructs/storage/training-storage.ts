import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';

export interface TrainingStorageProps {
  resourcePrefix: string;
  removalPolicy?: RemovalPolicy;
}

export class TrainingStorageConstruct extends Construct {
  public readonly dataBucket: s3.Bucket;
  public readonly modelsBucket: s3.Bucket;
  public readonly checkpointsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: TrainingStorageProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // S3 bucket for training data (JSONL files)
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `${props.resourcePrefix}-data`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'archive-old-data',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: Duration.days(30),
            },
          ],
        },
      ],
    });

    // S3 bucket for model artifacts with versioning enabled
    this.modelsBucket = new s3.Bucket(this, 'ModelsBucket', {
      bucketName: `${props.resourcePrefix}-models`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true, // Enable versioning for model artifacts
      removalPolicy: removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'archive-old-versions',
          enabled: true,
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(90),
            },
          ],
          noncurrentVersionExpiration: Duration.days(365),
        },
      ],
    });

    // S3 bucket for training checkpoints with lifecycle policy to move to IA after 30 days
    this.checkpointsBucket = new s3.Bucket(this, 'CheckpointsBucket', {
      bucketName: `${props.resourcePrefix}-checkpoints`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'move-to-ia',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(30),
            },
          ],
          expiration: Duration.days(180), // Delete old checkpoints after 6 months
        },
      ],
    });
  }
}
