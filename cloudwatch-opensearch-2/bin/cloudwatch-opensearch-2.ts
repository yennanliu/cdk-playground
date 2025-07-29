#!/usr/bin/env node
// import * as cdk from 'aws-cdk-lib';
// import { CloudwatchOpensearch2Stack } from '../lib/cloudwatch-opensearch-2-stack';

// const app = new cdk.App();
// new CloudwatchOpensearch2Stack(app, 'CloudwatchOpensearch2Stack');

import * as cdk from 'aws-cdk-lib';
import { LoggingStack } from '../lib/logging-stack';
import { OpensearchStack } from '../lib/opensearch-stack';

const app = new cdk.App();

// Create the stacks
const loggingStack = new LoggingStack(app, 'LoggingStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
    },
});

const opensearchStack = new OpensearchStack(app, 'OpensearchStack-4', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
    },
    vpc: loggingStack.vpc,
});
