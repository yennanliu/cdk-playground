#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RedisCluster1Stack } from '../lib/redis-cluster-1-stack';

const app = new cdk.App();
new RedisCluster1Stack(app, 'RedisCluster1Stack-6');
