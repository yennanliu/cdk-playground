#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FirehoseOpensearch1Stack } from '../lib/firehose-opensearch-1-stack';

const app = new cdk.App();

// Get configuration from context or environment variables
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Create the main stack with configuration
new FirehoseOpensearch1Stack(app, 'FirehoseOpensearch1Stack', {
  env,
  description: 'Kinesis Firehose to OpenSearch with log processing capabilities',
  
  // Stack configuration
  domainName: 'firehose-opensearch-domain',
  indexName: 'logs',
  deliveryStreamName: 'firehose-opensearch-stream',
  enableVpc: false,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});