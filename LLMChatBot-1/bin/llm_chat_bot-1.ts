#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LlmChatBot1Stack } from '../lib/llm_chat_bot-1-stack';

const app = new cdk.App();
new LlmChatBot1Stack(app, 'LlmChatBot1Stack');
