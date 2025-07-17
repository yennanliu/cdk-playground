#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { JPostgreRedisEcsStack } from '../lib/j-postgre-redis-ecs-stack';

const app = new cdk.App();
new JPostgreRedisEcsStack(app, 'JPostgreRedisEcsStack');
