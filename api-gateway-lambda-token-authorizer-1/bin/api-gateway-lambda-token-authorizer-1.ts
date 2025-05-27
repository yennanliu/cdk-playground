#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiGatewayLambdaTokenAuthorizer1Stack } from '../lib/api-gateway-lambda-token-authorizer-1-stack';

const app = new cdk.App();
new ApiGatewayLambdaTokenAuthorizer1Stack(app, 'ApiGatewayLambdaTokenAuthorizer1Stack');
