import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';
import { ApiStack } from './api-stack';

export class ImgRecogApp1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create storage stack
    const storageStack = new StorageStack(this, 'StorageStack');

    // Create API stack
    const apiStack = new ApiStack(this, 'ApiStack', {
      imageBucket: storageStack.imageBucket,
      resultsTable: storageStack.resultsTable,
    });

    // Create S3 bucket for web hosting
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `img-recog-web-${this.account}-${this.region}`,
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Deploy web files to S3
    const deployment = new s3deploy.BucketDeployment(this, 'WebDeployment', {
      sources: [s3deploy.Source.asset('./web')],
      destinationBucket: webBucket,
      prune: false,
    });

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: new origins.S3StaticWebsiteOrigin(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    // Outputs
    new CfnOutput(this, 'WebUIUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Web UI URL',
    });

    new CfnOutput(this, 'ApiEndpoint', {
      value: apiStack.api.url,
      description: 'API Gateway endpoint URL',
    });

    new CfnOutput(this, 'ImageBucketName', {
      value: storageStack.imageBucket.bucketName,
      description: 'S3 bucket name for images',
    });

    new CfnOutput(this, 'ResultsTableName', {
      value: storageStack.resultsTable.tableName,
      description: 'DynamoDB table name for results',
    });
  }
}
