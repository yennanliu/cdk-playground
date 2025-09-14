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

    // Create S3 bucket for web hosting with public read access
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
    });

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: new origins.HttpOrigin(webBucket.bucketWebsiteDomainName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Deploy web files to S3
    const deployment = new s3deploy.BucketDeployment(this, 'WebDeployment', {
      sources: [s3deploy.Source.asset('./web')],
      destinationBucket: webBucket,
      distribution: distribution,
      distributionPaths: ['/*'],
      prune: false,
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
