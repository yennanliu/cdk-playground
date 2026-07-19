#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { OllamaStack1Stack } from '../lib/ollama-stack-1-stack';

const app = new cdk.App();

new OllamaStack1Stack(app, 'OllamaStack1Stack', {
  // Default VPC lookup needs a concrete account/region (no env-agnostic lookups).
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
