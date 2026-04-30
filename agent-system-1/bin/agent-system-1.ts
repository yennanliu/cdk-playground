#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AgentTeamStack } from '../lib/agent-team-stack';

const app = new cdk.App();
new AgentTeamStack(app, 'AgentTeamStack');
