#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest1Stack } from '../lib/muse-test-1-stack';

const app = new cdk.App();
new MuseTest1Stack(app, 'MuseTest1Stack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  bedrockModelId: app.node.tryGetContext('bedrockModelId'),
  allowedDomains: app.node.tryGetContext('allowedDomains')?.split(','),
});
