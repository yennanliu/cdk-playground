#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthorizerStack } from '../lib/authorizer-stack';

const app = new cdk.App();
new AuthorizerStack(app, 'AuthorizerStack');
