#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AppReadWritePostgreStack1Stack } from '../lib/app-read-write-postgre-stack-1-stack';

const app = new cdk.App();
new AppReadWritePostgreStack1Stack(app, 'AppReadWritePostgreStack1Stack');
