#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MazeCdkStack } from '../lib/maze-cdk-stack';

const app = new cdk.App();
new MazeCdkStack(app, 'MazeCdkStack-2');
