import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

export class VideoUploadPlayerStack1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for video storage
    const videoBucket = new s3.Bucket(this, "VideoBucket", {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: ["*"], // In production, restrict this to your domain
          allowedHeaders: ["*"],
        },
      ],
    });

    // DynamoDB table for video metadata
    const videoTable = new dynamodb.Table(this, "VideoTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "videoId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Lambda function for handling video operations
    const videoHandler = new lambda.Function(this, "VideoHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda")),
      environment: {
        VIDEO_TABLE_NAME: videoTable.tableName,
        VIDEO_BUCKET_NAME: videoBucket.bucketName,
      },
    });

    // Grant permissions to Lambda
    videoBucket.grantReadWrite(videoHandler);
    videoTable.grantReadWriteData(videoHandler);

    // API Gateway
    const api = new apigateway.RestApi(this, "VideoApi", {
      restApiName: "Video Upload Service",
      description: "API for video upload and management",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // API Gateway resources and methods
    const videos = api.root.addResource("videos");
    const video = videos.addResource("{videoId}");
    const uploadUrl = api.root.addResource("upload-url");

    videos.addMethod("GET", new apigateway.LambdaIntegration(videoHandler));
    videos.addMethod("POST", new apigateway.LambdaIntegration(videoHandler));
    video.addMethod("GET", new apigateway.LambdaIntegration(videoHandler));
    uploadUrl.addMethod("GET", new apigateway.LambdaIntegration(videoHandler));

    // S3 bucket for frontend hosting
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "index.html",
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
    });

    // Add bucket policy to allow public read access
    frontendBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [frontendBucket.arnForObjects("*")],
        principals: [new iam.AnyPrincipal()],
      })
    );

    // Enable website hosting
    const websiteConfiguration = {
      indexDocument: "index.html",
      errorDocument: "index.html",
    };

    const cfnBucket = frontendBucket.node.defaultChild as s3.CfnBucket;
    cfnBucket.websiteConfiguration = websiteConfiguration;

    // CloudFront distribution for frontend
    const distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: api.url,
      description: "API Gateway endpoint URL",
    });

    new cdk.CfnOutput(this, "FrontendUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Frontend CloudFront URL",
    });

    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
      description: "Frontend S3 Bucket Name",
    });
  }
}
