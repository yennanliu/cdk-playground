#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SagemakerStack1Stack } from '../lib/sagemaker-stack-1-stack';

const app = new cdk.App();
new SagemakerStack1Stack(app, 'SagemakerStack1Stack-3');
