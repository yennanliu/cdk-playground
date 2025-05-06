#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsTest2Stack } from '../lib/ecs-test-2-stack';

const app = new cdk.App();
new EcsTest2Stack(app, 'EcsTest2Stack');
