import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class AiMusicGenStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3 bucket for generated music files
    const musicBucket = new s3.Bucket(this, 'MusicBucket', {
      bucketName: `ai-music-gen-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // Lambda function to generate music
    const generateMusicFn = new lambda.Function(this, 'GenerateMusicFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/generate-music')),
      timeout: Duration.minutes(15), // Max timeout for music generation
      memorySize: 512,
      environment: {
        MUSIC_BUCKET_NAME: musicBucket.bucketName,
        // Add your Replicate API token via environment variable or Secrets Manager
        // REPLICATE_API_TOKEN: 'your-token-here'
      },
    });

    // Grant Lambda permissions to write to S3
    musicBucket.grantWrite(generateMusicFn);
    musicBucket.grantPutAcl(generateMusicFn);

    // API Gateway
    const api = new apigateway.RestApi(this, 'MusicGenApi', {
      restApiName: 'AI Music Generation API',
      description: 'Simple API for generating music with AI',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // POST /generate endpoint
    const generateResource = api.root.addResource('generate');
    generateResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(generateMusicFn, {
        proxy: true,
        timeout: Duration.seconds(29), // API Gateway max timeout is 29 seconds
      })
    );

    // Outputs
    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new CfnOutput(this, 'MusicBucketName', {
      value: musicBucket.bucketName,
      description: 'S3 bucket for generated music',
    });

    new CfnOutput(this, 'GenerateEndpoint', {
      value: `${api.url}generate`,
      description: 'POST endpoint for music generation',
    });
  }
}
