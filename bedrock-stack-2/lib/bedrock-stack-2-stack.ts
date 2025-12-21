import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class BedrockStack2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Lambda function for resume updating
    const resumeUpdaterFn = new lambda.Function(this, 'ResumeUpdaterFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'resumeUpdater.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: Duration.seconds(60),
      memorySize: 1024
    });

    // Grant Bedrock permissions (for both direct models and inference profiles)
    resumeUpdaterFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`
      ]
    }));

    // API Gateway
    const api = new apigateway.RestApi(this, 'ResumeUpdaterAPI', {
      restApiName: 'Resume Updater Service',
      description: 'AI-powered resume optimization API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      }
    });

    const updateResource = api.root.addResource('update');
    updateResource.addMethod('POST', new apigateway.LambdaIntegration(resumeUpdaterFn));

    // Output API URL
    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Resume Updater API URL'
    });
  }
}
