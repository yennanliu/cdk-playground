#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CloudwatchOpensearch2Stack } from '../lib/cloudwatch-opensearch-2-stack';

const app = new cdk.App();
new CloudwatchOpensearch2Stack(app, 'CloudwatchOpensearch2Stack');
