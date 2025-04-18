import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class MyCdkS3BucketStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a new S3 bucket
    new s3.Bucket(this, 'MyFirstBucket-', {
      bucketName: 'my-first-cdk-bucket-2',  // Unique name for the bucket
      versioned: true,  // Enable versioning for the bucket
      removalPolicy: cdk.RemovalPolicy.DESTROY,  // Automatically delete the bucket when the stack is deleted
      autoDeleteObjects: true,  // Automatically delete objects when the bucket is deleted
    });
  }
}
