#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DistributedBiAppStack } from '../lib/distributed-bi-app-stack';

const app = new cdk.App();
new DistributedBiAppStack(app, 'DistributedBiAppStack');
