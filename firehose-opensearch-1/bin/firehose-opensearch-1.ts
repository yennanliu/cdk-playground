#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FirehoseOpensearch1Stack } from '../lib/firehose-opensearch-1-stack';

const app = new cdk.App();
new FirehoseOpensearch1Stack(app, 'FirehoseOpensearch1Stack');
