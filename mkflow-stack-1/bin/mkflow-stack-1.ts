#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MkflowStack1Stack } from '../lib/mkflow-stack-1-stack';

const app = new cdk.App();
new MkflowStack1Stack(app, 'MkflowStack1Stack');
