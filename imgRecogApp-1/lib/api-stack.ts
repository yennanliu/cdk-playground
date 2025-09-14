import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface ApiStackProps extends StackProps {
  imageBucket: s3.Bucket;
  resultsTable: dynamodb.Table;
}

export class ApiStack extends Stack {
  public readonly api: apigateway.RestApi;
  public readonly processImageFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Lambda function for processing images
    this.processImageFunction = new lambda.Function(this, 'ProcessImageFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: Duration.seconds(30),
      environment: {
        BUCKET_NAME: props.imageBucket.bucketName,
        TABLE_NAME: props.resultsTable.tableName,
      },
    });

    // Grant permissions to Lambda function
    props.imageBucket.grantReadWrite(this.processImageFunction);
    props.resultsTable.grantReadWriteData(this.processImageFunction);

    // Grant Rekognition permissions
    this.processImageFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['rekognition:DetectLabels'],
        resources: ['*'],
      })
    );

    // API Gateway
    this.api = new apigateway.RestApi(this, 'ImageRecognitionApi', {
      restApiName: 'Image Recognition API',
      description: 'API for image recognition service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(this.processImageFunction);

    // API routes
    this.api.root.addMethod('GET', lambdaIntegration); // Add root endpoint
    this.api.root.addResource('upload-url').addMethod('POST', lambdaIntegration);
    this.api.root.addResource('process-image').addMethod('POST', lambdaIntegration);

    const resultsResource = this.api.root.addResource('results');
    resultsResource.addResource('{imageId}').addMethod('GET', lambdaIntegration);
  }
}