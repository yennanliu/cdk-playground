#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClaudeInfraStack } from '../lib/claude-infra-stack';
import { ClaudeMultiUserStack } from '../lib/claude-multi-user-stack';

const app = new cdk.App();

// Get environment from context or use default
const env = app.node.tryGetContext('env') || 'dev';
const multiUser = app.node.tryGetContext('multiUser') === 'true';
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'ap-northeast-1';

const stackEnv = {
  account: account,
  region: region,
};

const stackTags = {
  Environment: env,
  Project: 'claude-code',
  ManagedBy: 'CDK',
};

if (multiUser) {
  // Deploy multi-user stack
  new ClaudeMultiUserStack(app, `${env}-claude-multi-user-stack`, {
    env: stackEnv,
    tags: stackTags,
    description: 'Multi-user infrastructure for Claude Code on AWS ECS Fargate',
    stackName: `${env}-claude-multi-user-stack`,
  });
} else {
  // Deploy single-user stack (default)
  new ClaudeInfraStack(app, `${env}-claude-infra-stack`, {
    env: stackEnv,
    tags: stackTags,
    description: 'Single-user infrastructure for Claude Code on AWS ECS Fargate',
    stackName: `${env}-claude-infra-stack`,
  });
}

app.synth();
