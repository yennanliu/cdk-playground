import { Duration, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class LlmChatBot1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3 Bucket for frontend
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: undefined, // Let AWS generate unique name
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: false, // Will use CloudFront OAC instead
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront Distribution with Origin Access Identity (OAI)
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for frontend bucket',
    });

    // Grant CloudFront OAI access to the bucket
    frontendBucket.grantRead(originAccessIdentity);

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/error.html',
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: '/error.html',
          ttl: Duration.minutes(5),
        },
      ],
    });

    // DynamoDB Table for chat history
    const chatTable = new dynamodb.Table(this, 'ChatTable', {
      tableName: 'ChatHistory',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Lambda function for chat processing
    const chatLambda = new lambda.Function(this, 'ChatLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: Duration.seconds(30),
      environment: {
        CHAT_TABLE_NAME: chatTable.tableName,
        BEDROCK_REGION: this.region,
      },
    });

    // Grant Lambda permissions
    chatTable.grantReadWriteData(chatLambda);

    // Bedrock permissions
    chatLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: ['*'],
    }));

    // API Gateway
    const api = new apigateway.RestApi(this, 'ChatApi', {
      restApiName: 'LLM Chat API',
      description: 'API for LLM chatbot',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    const chatResource = api.root.addResource('chat');
    chatResource.addMethod('POST', new apigateway.LambdaIntegration(chatLambda));

    // Outputs
    this.exportValue(distribution.distributionDomainName, {
      name: 'CloudFrontUrl',
    });

    this.exportValue(api.url, {
      name: 'ApiUrl',
    });

    this.exportValue(frontendBucket.bucketName, {
      name: 'FrontendBucketName',
    });

    // Deploy frontend files to S3
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset('./frontend')],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
    });
  }
}
