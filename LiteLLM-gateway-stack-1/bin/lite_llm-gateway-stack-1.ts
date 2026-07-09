#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { LiteLlmGatewayStack1Stack } from '../lib/lite_llm-gateway-stack-1-stack';

const app = new cdk.App();

// Single knob for the deploy's identity. Bump the version (v1 -> v2) to stand up
// a fresh, independently-named stack (and its DB / ECS / ALB) alongside or in
// place of the old one — makes teardown and re-deploy easy to track.
// Overridable at deploy time with `-c appName=... -c version=...`.
const appName = (app.node.tryGetContext('appName') as string | undefined) ?? 'litellm-gateway';
const version = (app.node.tryGetContext('version') as string | undefined) ?? 'v1';
const resourceName = `${appName}-${version}`;

new LiteLlmGatewayStack1Stack(app, resourceName, {
  stackName: resourceName,
  resourceName,
});
