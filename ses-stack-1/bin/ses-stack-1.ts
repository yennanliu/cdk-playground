#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SesStack1Stack } from '../lib/ses-stack-1-stack';

const app = new cdk.App();
new SesStack1Stack(app, 'SesStack1Stack');
