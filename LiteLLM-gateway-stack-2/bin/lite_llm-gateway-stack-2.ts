#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { LiteLlmGatewayStack2Stack } from '../lib/lite_llm-gateway-stack-2-stack';

const app = new cdk.App();
new LiteLlmGatewayStack2Stack(app, 'LiteLlmGatewayStack2Stack');
