#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StackComposer } from '../lib/stack-composer';

const app = new cdk.App();

// Create the StackComposer which will orchestrate all the stacks
const stackComposer = new StackComposer(app, {
  stage: 'dev',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
