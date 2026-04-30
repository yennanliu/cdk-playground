#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AgentSystem1Stack } from '../lib/agent-system-1-stack';

const app = new cdk.App();
new AgentSystem1Stack(app, 'AgentSystem1Stack');
