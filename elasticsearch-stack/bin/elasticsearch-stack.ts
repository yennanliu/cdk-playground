#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ElasticsearchStackStack } from '../lib/elasticsearch-stack-stack';

const app = new cdk.App();
new ElasticsearchStackStack(app, 'ElasticsearchStackStack');
