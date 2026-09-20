#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { SlackAgent1Stack } from '../lib/slack-agent-1-stack';

const app = new cdk.App();

new SlackAgent1Stack(app, 'SlackAgent1Stack', {
  description: 'Slack agent, Phase 0: single host, Socket Mode, containerized jobs',
  // Pinned to the ambient account/region: the stack looks up the latest
  // Amazon Linux 2023 AMI, which an environment-agnostic stack cannot do.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  // Override per environment with `-c bedrockModelId=... -c natGateways=1`.
  bedrockModelId: app.node.tryGetContext('bedrockModelId'),
  natGateways: numberContext(app, 'natGateways'),
  rootVolumeGiB: numberContext(app, 'rootVolumeGiB'),
});

function numberContext(app: cdk.App, key: string): number | undefined {
  const raw = app.node.tryGetContext(key);
  return raw === undefined ? undefined : Number(raw);
}
