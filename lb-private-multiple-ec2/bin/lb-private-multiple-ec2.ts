#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LbPrivateMultipleEc2Stack } from '../lib/lb-private-multiple-ec2-stack';

const app = new cdk.App();
new LbPrivateMultipleEc2Stack(app, 'LbPrivateMultipleEc2Stack');
