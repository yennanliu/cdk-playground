import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export class StockSummaryStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Lambda function for stock news summarization
    const summaryFunction = new NodejsFunction(this, 'StockSummaryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/index.ts'),
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        BEDROCK_MODEL_ID: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      },
      bundling: {
        externalModules: [],
        nodeModules: ['axios', '@aws-sdk/client-bedrock-runtime'],
      },
    });

    // Grant Bedrock permissions to Lambda
    summaryFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`,
        ],
      })
    );

    // API Gateway REST API
    const api = new apigateway.RestApi(this, 'StockSummaryApi', {
      restApiName: 'Stock News Summary Service',
      description: 'API for summarizing stock news using AI',
      deployOptions: {
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // API Gateway integration with Lambda
    const summaryIntegration = new apigateway.LambdaIntegration(summaryFunction);

    // Create /summarize endpoint
    const summarizeResource = api.root.addResource('summarize');
    summarizeResource.addMethod('POST', summaryIntegration);

    // Output API endpoint
    new CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new CfnOutput(this, 'SummarizeEndpoint', {
      value: `${api.url}summarize`,
      description: 'POST endpoint for stock news summarization',
    });
  }
}
