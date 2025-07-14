#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EksStack2Stack } from '../lib/eks-stack-2-stack';

const app = new cdk.App();
new EksStack2Stack(app, 'EksStack2Stack-2');
