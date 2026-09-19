#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { SlackAgent1Stack } from '../lib/slack-agent-1-stack';

const app = new cdk.App();
new SlackAgent1Stack(app, 'SlackAgent1Stack');
