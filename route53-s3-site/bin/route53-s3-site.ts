#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Route53S3SiteStack } from '../lib/route53-s3-site-stack';

const app = new cdk.App();
new Route53S3SiteStack(app, 'Route53S3SiteStack', {
  // You must specify a specific region when using S3 website endpoints with Route53
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1', // S3 website endpoints require a specific region
  },
  // Optional: Customize the domain name (default is 'example.com')
  // domainName: 'your-domain.com',
});
