#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsTest1Stack } from '../lib/ecs-test-1-stack';

const app = new cdk.App();
new EcsTest1Stack(app, 'EcsTest1Stack');
