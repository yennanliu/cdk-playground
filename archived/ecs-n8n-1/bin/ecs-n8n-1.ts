#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsN8nStack } from '../lib/ecs-n8n-1-stack';

const app = new cdk.App();
new EcsN8nStack(app, 'EcsN8nStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  }
});
