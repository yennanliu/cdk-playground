#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiGatewayLambdaTokenAuthorizerStack } from '../lib/stack/api-gateway-lambda-token-authorizer-stack';

const app = new cdk.App();
// new ApiGatewayLambdaTokenAuthorizerStack(app, 'ApiGatewayLambdaTokenAuthorizerStack');
new ApiGatewayLambdaTokenAuthorizerStack(app, 'gateway-lambda-auth-stack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    }
});