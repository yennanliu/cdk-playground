#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CloudwatchOpensearch1Stack } from '../lib/cloudwatch-opensearch-1-stack';

const app = new cdk.App();
new CloudwatchOpensearch1Stack(app, 'CloudwatchOpensearch1Stack');
