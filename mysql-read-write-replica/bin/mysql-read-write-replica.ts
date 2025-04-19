#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MysqlReadWriteReplicaStack } from '../lib/mysql-read-write-replica-stack';

const app = new cdk.App();
new MysqlReadWriteReplicaStack(app, 'MysqlReadWriteReplicaStack');
