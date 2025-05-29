#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RedisSentinel1Stack } from '../lib/redis-sentinel-1-stack';

const app = new cdk.App();
new RedisSentinel1Stack(app, 'RedisSentinel1Stack');
