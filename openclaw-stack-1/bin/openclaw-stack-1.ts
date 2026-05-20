#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { OpenclawStack1Stack } from '../lib/openclaw-stack-1-stack';

const app = new cdk.App();
new OpenclawStack1Stack(app, 'OpenclawStack1Stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
