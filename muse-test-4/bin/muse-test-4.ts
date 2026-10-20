#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest4Stack } from '../lib/muse-test-4-stack';

const app = new cdk.App();
new MuseTest4Stack(app, 'MuseTest4Stack', {
  // A concrete account and region: the stack looks up AWS-managed prefix lists.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  bedrockModelId: app.node.tryGetContext('bedrockModelId'),
  allowedDomains: app.node.tryGetContext('allowedDomains')?.split(','),
  idleMinutes: app.node.tryGetContext('idleMinutes') && Number(app.node.tryGetContext('idleMinutes')),
});
