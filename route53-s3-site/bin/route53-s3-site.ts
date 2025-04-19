#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Route53S3SiteStack } from '../lib/route53-s3-site-stack';

const app = new cdk.App();
new Route53S3SiteStack(app, 'Route53S3SiteStack', {
  // Optional: Uncomment and customize to deploy to a specific account/region
  // env: {
  //   account: process.env.CDK_DEFAULT_ACCOUNT,
  //   region: process.env.CDK_DEFAULT_REGION,
  // },
  // Optional: Customize the domain name (default is 'example.com')
  // domainName: 'your-domain.com',
});
