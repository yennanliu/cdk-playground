#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BedrockStack2Stack } from '../lib/bedrock-stack-2-stack';

const app = new cdk.App();
new BedrockStack2Stack(app, 'BedrockStack2Stack', {
  env: {
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT
  }
});
