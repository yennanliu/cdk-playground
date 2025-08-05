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
const stack = new FirehoseOpensearch1Stack(app, 'FirehoseOpensearch1Stack', {
  env,
  description: 'Kinesis Firehose to OpenSearch pipeline with modular constructs',
  
  // Stack configuration - these can be overridden via CDK context
  domainName: app.node.tryGetContext('domainName') || 'firehose-opensearch-domain',
  deliveryStreamName: app.node.tryGetContext('deliveryStreamName') || 'firehose-opensearch-stream',
  indexName: app.node.tryGetContext('indexName') || 'logs',
  enableVpc: app.node.tryGetContext('enableVpc') || false,
  removalPolicy: app.node.tryGetContext('removalPolicy') === 'RETAIN' 
    ? cdk.RemovalPolicy.RETAIN 
    : cdk.RemovalPolicy.DESTROY,
  
  // Tags for all resources
  tags: {
    Project: 'FirehoseOpenSearch',
    Environment: app.node.tryGetContext('environment') || 'dev',
    Owner: app.node.tryGetContext('owner') || 'cdk-team',
  },
});

// Add tags to the app
cdk.Tags.of(app).add('Project', 'FirehoseOpenSearch');
cdk.Tags.of(app).add('ManagedBy', 'AWS-CDK');
