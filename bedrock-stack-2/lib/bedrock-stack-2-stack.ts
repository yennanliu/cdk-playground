import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class BedrockStack2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3 bucket for resume uploads
    const resumeBucket = new s3.Bucket(this, 'ResumeBucket', {
      cors: [{
        allowedOrigins: ['*'],
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
        allowedHeaders: ['*'],
        exposedHeaders: ['ETag']
      }],
      lifecycleRules: [{
        expiration: Duration.days(7), // Auto-delete old files after 7 days
      }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // DynamoDB table for storing resume update history
    const historyTable = new dynamodb.Table(this, 'HistoryTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl' // Auto-delete old records
    });

    // Lambda function for resume updating
    const resumeUpdaterFn = new lambda.Function(this, 'ResumeUpdaterFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'resumeUpdater.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: Duration.seconds(60),
      memorySize: 1024,
      environment: {
        RESUME_BUCKET: resumeBucket.bucketName,
        HISTORY_TABLE: historyTable.tableName
      }
    });

    // Grant Bedrock permissions (for both direct models and inference profiles)
    resumeUpdaterFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`
      ]
    }));

    // Grant S3 and DynamoDB permissions
    resumeBucket.grantRead(resumeUpdaterFn);
    historyTable.grantWriteData(resumeUpdaterFn);

    // Lambda for generating presigned upload URLs
    const uploadFn = new lambda.Function(this, 'UploadFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'upload.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        RESUME_BUCKET: resumeBucket.bucketName
      }
    });

    // Grant S3 write permissions for upload
    resumeBucket.grantPut(uploadFn);

    // API Gateway
    const api = new apigateway.RestApi(this, 'ResumeUpdaterAPI', {
      restApiName: 'Resume Updater Service',
      description: 'AI-powered resume optimization API',
      binaryMediaTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      }
    });

    // API endpoints
    const updateResource = api.root.addResource('update');
    updateResource.addMethod('POST', new apigateway.LambdaIntegration(resumeUpdaterFn));

    const uploadResource = api.root.addResource('upload');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(uploadFn));

    // Outputs
    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Resume Updater API URL'
    });

    new CfnOutput(this, 'BucketName', {
      value: resumeBucket.bucketName,
      description: 'S3 Bucket for resume uploads'
    });

    new CfnOutput(this, 'TableName', {
      value: historyTable.tableName,
      description: 'DynamoDB table for history'
    });
  }
}
