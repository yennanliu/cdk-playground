#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsWordpress2Stack } from '../lib/ecs-wordpress-2-stack';

const app = new cdk.App();
new EcsWordpress2Stack(app, 'EcsWordpress2Stack');
