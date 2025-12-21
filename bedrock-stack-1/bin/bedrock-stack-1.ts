#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BedrockStack1Stack } from '../lib/bedrock-stack-1-stack';

const app = new cdk.App();
new BedrockStack1Stack(app, 'BedrockStack1Stack');
