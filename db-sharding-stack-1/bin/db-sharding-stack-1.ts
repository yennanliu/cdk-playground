#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DbShardingStack1Stack } from '../lib/db-sharding-stack-1-stack';

const app = new cdk.App();
new DbShardingStack1Stack(app, 'DbShardingStack1Stack');
