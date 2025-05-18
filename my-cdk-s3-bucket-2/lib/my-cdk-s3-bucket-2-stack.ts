import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";

export class MyCdkS3Bucket2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a new S3 bucket
    for (let i = 1; i <= 3; i++) {
      console.log(`>>> Build S3 bucket :  ${i}`);
      new s3.Bucket(this, `my-second-bucket-${i}`, {
        bucketName: `my-second-cdk-bucket-${i}`, // Unique name for the bucket
        versioned: true, // Enable versioning for the bucket
        removalPolicy: cdk.RemovalPolicy.DESTROY, // Automatically delete the bucket when the stack is deleted
        autoDeleteObjects: true, // Automatically delete objects when the bucket is deleted
      });
    }
  }
}
