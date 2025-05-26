import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from 'aws-cdk-lib/aws-ec2';

import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';


export class MyCdkS3Bucket2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a new S3 bucket
    const buckets: s3.Bucket[] = [];
    for (let i = 1; i <= 3; i++) {
      console.log(`>>> Build S3 bucket :  ${i}`);
      const bucket = new s3.Bucket(this, `my-second-bucket-${i}`, {
        bucketName: `my-second-cdk-bucket-${i}`,
        versioned: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
      buckets.push(bucket);
    }

    // Create a Lambda function
    const myLambdaFunction = new lambda.Function(this, 'MyLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda')),
      handler: 'handler.handler',
      environment: {
        BUCKET_NAME: `my-second-cdk-bucket-1`,
      },
    });

    // NOTE !!! grant the Lambda function permission to read from the S3 bucket
    // Grant the Lambda function permission to write to the S3 bucket
    buckets[0].grantPut(myLambdaFunction);

    const api = new apigateway.RestApi(this, 'simeple-api', {
      restApiName: 'simple-api',
      description: 'This is a simple API',
    });

    // Create a resource and method for the Lambda function
    const lambdaIntegration = new apigateway.LambdaIntegration(myLambdaFunction);
    const resource = api.root.addResource('timestamp');
    resource.addMethod('GET', lambdaIntegration); // Add a POST method to call the Lambda
  }


}
