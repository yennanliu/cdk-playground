#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { S3SiteLambdaCloudwatchStack } from '../lib/s3-site-lambda-cloudwatch-stack';

const app = new cdk.App();
new S3SiteLambdaCloudwatchStack(app, 'S3SiteLambdaCloudwatchStack');
