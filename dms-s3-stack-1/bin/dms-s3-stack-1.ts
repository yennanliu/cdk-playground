#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DmsS3Stack1Stack } from '../lib/dms-s3-stack-1-stack';

const app = new cdk.App();
new DmsS3Stack1Stack(app, 'DmsS3Stack1Stack-3');
