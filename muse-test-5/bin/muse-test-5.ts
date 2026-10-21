#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest5Stack } from '../lib/muse-test-5-stack';

const app = new cdk.App();
const context = (key: string): string | undefined => app.node.tryGetContext(key);
new MuseTest5Stack(app, 'MuseTest5Stack', {
  // A concrete account and region: the stack looks up an AWS-managed prefix list.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  bedrockModelId: context('bedrockModelId'),
  allowedDomains: context('allowedDomains')?.split(','),
  idleMinutes: context('idleMinutes') ? Number(context('idleMinutes')) : undefined,
  sandboxNodes: context('sandboxNodes') ? Number(context('sandboxNodes')) : undefined,
  adminPrincipalArn: context('adminPrincipalArn'),
});
