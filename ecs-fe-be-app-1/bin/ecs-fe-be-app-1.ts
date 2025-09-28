#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsFeBeApp1Stack } from '../lib/ecs-fe-be-app-1-stack';

const app = new cdk.App();
new EcsFeBeApp1Stack(app, 'EcsFeBeApp1Stack-2');
