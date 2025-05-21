import { Duration, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';

export class MazeTest1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB Table for storing mazes
    const mazeTable = new dynamodb.Table(this, 'MazeTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Lambda function for maze operations
    const mazeFunction = new lambda.Function(this, 'MazeGeneratorFunction', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: mazeTable.tableName,
      },
    });

    // Grant DynamoDB permissions to Lambda
    mazeTable.grantReadWriteData(mazeFunction);

    // API Gateway
    const api = new apigateway.RestApi(this, 'MazeApi', {
      restApiName: 'Maze Generator API',
      description: 'API for maze generation and management',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
        maxAge: Duration.days(1),
      },
      deployOptions: {
        stageName: 'prod',
      },
    });

    // Add the methods
    const mazes = api.root.addResource('mazes');
    mazes.addMethod('POST', new apigateway.LambdaIntegration(mazeFunction));
    mazes.addMethod('GET', new apigateway.LambdaIntegration(mazeFunction));

    const mazeById = mazes.addResource('{id}');
    mazeById.addMethod('GET', new apigateway.LambdaIntegration(mazeFunction));

    // S3 bucket for frontend
    const websiteBucket = new s3.Bucket(this, 'MazeWebsiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'MazeDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    // Create a temporary directory for the frontend files
    const frontendDir = path.join(__dirname, '../frontend');
    const tempDir = path.join(__dirname, '../temp-frontend');
    fs.mkdirSync(tempDir, { recursive: true });

    // Copy frontend files to temp directory
    fs.readdirSync(frontendDir).forEach(file => {
      if (file === 'config.js') {
        // Replace API URL in config.js
        const configContent = fs.readFileSync(path.join(frontendDir, file), 'utf8');
        const updatedConfig = configContent.replace('{{API_URL}}', api.url);
        fs.writeFileSync(path.join(tempDir, file), updatedConfig);
      } else {
        // Copy other files as is
        fs.copyFileSync(path.join(frontendDir, file), path.join(tempDir, file));
      }
    });

    // Deploy frontend to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(tempDir)],
      destinationBucket: websiteBucket,
      distribution,
    });

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Output the CloudFront URL
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
    });

    // Output the API Gateway URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });
  }
}
