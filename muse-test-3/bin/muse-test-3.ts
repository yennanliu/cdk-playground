#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest3Stack } from '../lib/muse-test-3-stack';

const app = new cdk.App();
new MuseTest3Stack(app, 'MuseTest3Stack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  bedrockModelId: app.node.tryGetContext('bedrockModelId'),
  allowedDomains: app.node.tryGetContext('allowedDomains')?.split(','),
});
