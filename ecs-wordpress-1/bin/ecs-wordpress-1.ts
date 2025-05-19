#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsWordpress1Stack } from '../lib/ecs-wordpress-1-stack';

const app = new cdk.App();
new EcsWordpress1Stack(app, 'EcsWordpress1Stack');
