#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SupersetStack1Stack } from '../lib/superset-stack-1-stack';

const app = new cdk.App();
new SupersetStack1Stack(app, 'SupersetStack1Stack-1');
