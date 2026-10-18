#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest2Stack } from '../lib/muse-test-2-stack';

const app = new cdk.App();
new MuseTest2Stack(app, 'MuseTest2Stack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  bedrockModelId: app.node.tryGetContext('bedrockModelId'),
  allowedDomains: app.node.tryGetContext('allowedDomains')?.split(','),
});
