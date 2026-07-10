#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SupersetStack2Stack } from '../lib/superset-stack-2-stack';

const app = new cdk.App();
new SupersetStack2Stack(app, 'SupersetStack2Stack-4');
