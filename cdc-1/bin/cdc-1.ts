#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Cdc1Stack } from '../lib/cdc-1-stack';

const app = new cdk.App();
new Cdc1Stack(app, 'Cdc1Stack');
