#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DmsMysqlKinesisCloudwatch1Stack } from '../lib/dms-mysql-kinesis-cloudwatch-1-stack';

const app = new cdk.App();
new DmsMysqlKinesisCloudwatch1Stack(app, 'DmsMysqlKinesisCloudwatch1Stack-3');
