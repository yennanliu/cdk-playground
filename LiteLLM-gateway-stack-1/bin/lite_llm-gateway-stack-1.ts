#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { LiteLlmGatewayStack1Stack } from '../lib/lite_llm-gateway-stack-1-stack';

const app = new cdk.App();
new LiteLlmGatewayStack1Stack(app, 'LiteLlmGatewayStack1Stack');
