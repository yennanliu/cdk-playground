#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsN8N1Stack } from '../lib/ecs-n8n-1-stack';

const app = new cdk.App();
new EcsN8N1Stack(app, 'EcsN8N1Stack');
