#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiGatewayLambdaTokenAuthorizerStack } from '../lib/api-gateway-lambda-token-authorizer-stack';

const app = new cdk.App();
new ApiGatewayLambdaTokenAuthorizerStack(app, 'ApiGatewayLambdaTokenAuthorizerStack');
