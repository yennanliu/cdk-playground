#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EksStack1Stack } from '../lib/eks-stack-1-stack';

const app = new cdk.App();
new EksStack1Stack(app, 'EksStack1Stack');
