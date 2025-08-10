#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RedisSentinel2Stack } from '../lib/redis-sentinel-2-stack';

const app = new cdk.App();
new RedisSentinel2Stack(app, 'RedisSentinel2Stack-4');
