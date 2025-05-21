import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

export class MazeTest2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create an S3 bucket for website hosting
    const websiteBucket = new s3.Bucket(this, 'MazeWebsiteBucket', {
      websiteIndexDocument: 'index.html',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: RemovalPolicy.DESTROY, // For development purposes
      autoDeleteObjects: true, // For development purposes
    });

    // Add bucket policy to allow public read access
    websiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [websiteBucket.arnForObjects('*')],
        principals: [new iam.AnyPrincipal()],
      })
    );

    // Deploy the website files to the S3 bucket
    new s3deploy.BucketDeployment(this, 'DeployMazeWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../maze'))],
      destinationBucket: websiteBucket,
    });

    // Output the website URL
    new CfnOutput(this, 'WebsiteURL', {
      value: websiteBucket.bucketWebsiteUrl,
      description: 'The URL of the website',
    });
  }
}
