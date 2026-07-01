import { RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

// Two buckets:
//  - docsBucket: fully private; raw uploads land here and feed the Knowledge Base.
//  - webBucket:  S3 website hosting (public-read) for the static SPA — assets only.
export class Storage extends Construct {
  readonly docsBucket: s3.Bucket;
  readonly webBucket: s3.Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.docsBucket = new s3.Bucket(this, 'DocsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: ['*'], // dev/internal; tighten to the site origin later
        allowedHeaders: ['*'],
      }],
    });

    this.webBucket = new s3.Bucket(this, 'WebBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      // Allow the public-read bucket policy (block ACLs only).
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}
