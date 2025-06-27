#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ElasticsearchStack2Stack } from '../lib/elasticsearch-stack-2-stack';

const app = new cdk.App();
new ElasticsearchStack2Stack(app, 'ElasticsearchStack2Stack');
