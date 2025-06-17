import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from 'aws-cdk-lib/aws-ec2';

import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';


export class MyCdkS3Bucket2Stack extends cdk.Stack {
  private createLambdaFunction(
    id: string,
    handler: string,
    bucket: s3.Bucket,
    timeout?: cdk.Duration
  ): lambda.Function {
    const lambdaFunction = new lambda.Function(this, id, {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda')),
      handler: `handler.${handler}`,
      environment: {
        BUCKET_NAME: 'my-second-cdk-bucket-1',
      },
      timeout: timeout,
    });

    // Grant the Lambda function permission to write to the S3 bucket
    bucket.grantPut(lambdaFunction);

    return lambdaFunction;
  }

  private createApiEndpoint(
    api: apigateway.RestApi,
    lambda: lambda.Function,
    resourcePath: string
  ): apigateway.Method {
    const integration = new apigateway.LambdaIntegration(lambda);
    const resource = api.root.addResource(resourcePath);
    return resource.addMethod('GET', integration);
  }

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


    // api gateway ------------------------------------------------
    const api = new apigateway.RestApi(this, 'simeple-api', {
      restApiName: 'simple-api',
      description: 'This is a simple API',
    });


    // Lambda func 1) ------------------------------------------------
    const myLambdaFunction = this.createLambdaFunction(
      'MyLambdaFunction',
      'handler',
      buckets[0]
    );
    this.createApiEndpoint(api, myLambdaFunction, 'timestamp');

    // Lambda func 2) ------------------------------------------------
    const scrapeBooksLambda = this.createLambdaFunction(
      'ScrapeBooksLambda',
      'scrapeBooksToScrape',
      buckets[0],
      cdk.Duration.seconds(10)
    );
    this.createApiEndpoint(api, scrapeBooksLambda, 'scrape-books');

    // Lambda func 3) ------------------------------------------------
    const myLambdaFunction2 = this.createLambdaFunction(
      'MyLambdaFunction2',
      'handlerMath',
      buckets[0]
    );
    this.createApiEndpoint(api, myLambdaFunction2, 'math');

    // Lambda func 4) ------------------------------------------------
    const myLambdaFunction4 = this.createLambdaFunction(
      'MyLambdaFunction4',
      'wikiScraper',
      buckets[0]
    );
    this.createApiEndpoint(api, myLambdaFunction4, 'wikiScraper');
  }
}
