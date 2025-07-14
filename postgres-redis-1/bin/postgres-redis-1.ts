#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PostgresRedis1Stack } from '../lib/postgres-redis-1-stack';

const app = new cdk.App();
new PostgresRedis1Stack(app, 'PostgresRedis1Stack');
