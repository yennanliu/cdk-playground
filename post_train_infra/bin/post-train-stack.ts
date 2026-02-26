#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PostTrainStack } from '../lib/post-train-stack';

const app = new cdk.App();
const env = app.node.tryGetContext('env') || 'dev';
const region = app.node.tryGetContext('region') || 'ap-northeast-1';

new PostTrainStack(app, `PostTrainInfra-${env}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  stackName: `post-train-infra-${env}`,
  description: 'AWS CDK infrastructure for Qwen2.5-7B post-training with RAG',
  tags: {
    Environment: env,
    Project: 'post-train',
    ManagedBy: 'CDK',
  },
});
