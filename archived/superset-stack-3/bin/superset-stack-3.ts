#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SupersetStack3Stack } from '../lib/superset-stack-3-stack';

const app = new cdk.App();
new SupersetStack3Stack(app, 'SupersetStack3Stack');
