import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class UrlShortenerAppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB table to store URL mappings
    const urlTable = new dynamodb.Table(this, 'UrlShortenerTable', {
      partitionKey: {
        name: 'short_url_id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Use RETAIN in production
      timeToLiveAttribute: 'expiration_time', // Optional TTL for short URLs
    });

    // Lambda function for shortening URLs
    const shortenUrlFunction = new lambda.Function(this, 'ShortenUrlFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'shorten.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      environment: {
        TABLE_NAME: urlTable.tableName,
        SHORT_URL_LENGTH: '7', // Length of the generated short URL key
      },
      timeout: Duration.seconds(10),
    });

    // Lambda function for resolving/redirecting URLs
    const resolveUrlFunction = new lambda.Function(this, 'ResolveUrlFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'resolve.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      environment: {
        TABLE_NAME: urlTable.tableName,
      },
      timeout: Duration.seconds(10),
    });

    // Grant Lambda functions access to DynamoDB
    urlTable.grantReadWriteData(shortenUrlFunction);
    urlTable.grantReadData(resolveUrlFunction);

    // API Gateway for frontend interaction
    const api = new apigateway.RestApi(this, 'UrlShortenerApi', {
      restApiName: 'URL Shortener API',
      description: 'API for shortening and resolving URLs',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // API resources and methods
    const shortenResource = api.root.addResource('shorten');
    shortenResource.addMethod('POST', new apigateway.LambdaIntegration(shortenUrlFunction));

    const resolveResource = api.root.addResource('url');
    const resolveParam = resolveResource.addResource('{shortUrl}');
    resolveParam.addMethod('GET', new apigateway.LambdaIntegration(resolveUrlFunction));

    // S3 bucket for hosting the UI
    const uiHostingBucket = new s3.Bucket(this, 'UrlShortenerUi', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      removalPolicy: RemovalPolicy.DESTROY, // Use RETAIN in production
    });

    // Deploy UI assets to S3
    new s3deploy.BucketDeployment(this, 'DeployUrlShortenerUi', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../ui'))],
      destinationBucket: uiHostingBucket,
    });

    // Output values
    new CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'URL Shortener API Endpoint',
    });

    new CfnOutput(this, 'UiWebsiteUrl', {
      value: uiHostingBucket.bucketWebsiteUrl,
      description: 'URL Shortener Web UI',
    });
  }
}
