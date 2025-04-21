#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { S3SiteLambdaCloudwatchStack } from '../lib/s3-site-lambda-cloudwatch-stack';

const app = new cdk.App();
new S3SiteLambdaCloudwatchStack(app, 'S3SiteLambdaCloudwatchStack', {
  // Specify a region for deployment
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',  // Change this to your preferred region
  },
  // Uncomment and add your email to receive alarm notifications
  // alarmEmail: 'your-email@example.com',
});
