#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MysqlBinlogOpensearch1Stack } from '../lib/mysql-binlog-opensearch-1-stack';

const app = new cdk.App();
new MysqlBinlogOpensearch1Stack(app, 'MysqlBinlogOpensearch1Stack-2');
