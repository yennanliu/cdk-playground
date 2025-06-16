#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LoggingStack } from '../lib/logging-stack';
import { OpensearchStack } from '../lib/opensearch-stack';

const app = new cdk.App();

// Create the stacks
const loggingStack = new LoggingStack(app, 'LoggingStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
});

const opensearchStack = new OpensearchStack(app, 'OpensearchStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    vpc: loggingStack.vpc,
    logGroup: loggingStack.logGroup,
});
