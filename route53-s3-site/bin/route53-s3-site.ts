#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Route53S3SiteStack } from '../lib/route53-s3-site-stack';

const app = new cdk.App();
new Route53S3SiteStack(app, 'Route53S3SiteStack');
