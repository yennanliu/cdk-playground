#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthorizerStack1Stack } from '../lib/authorizer-stack-1-stack';

const app = new cdk.App();
new AuthorizerStack1Stack(app, 'AuthorizerStack1Stack');
