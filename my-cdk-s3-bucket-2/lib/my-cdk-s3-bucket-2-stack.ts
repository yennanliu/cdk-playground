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
    for (let i = 1; i <= 3; i++) {
      console.log(`>>> Build S3 bucket :  ${i}`);
      new s3.Bucket(this, `my-second-bucket-${i}`, {
        bucketName: `my-second-cdk-bucket-${i}`, // Unique name for the bucket
        versioned: true, // Enable versioning for the bucket
        removalPolicy: cdk.RemovalPolicy.DESTROY, // Automatically delete the bucket when the stack is deleted
        autoDeleteObjects: true, // Automatically delete objects when the bucket is deleted
      });
    }

    // Create a Lambda function
    const myLambdaFunction = new lambda.Function(this, 'MyLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_18_X, // Use the latest Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda')), // Path to the Lambda function code
      handler: 'handler.handler', // The file and function name
      environment: {
        BUCKET_NAME: `my-second-cdk-bucket-1`, // Environment variable for the bucket name
      },
    });

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
