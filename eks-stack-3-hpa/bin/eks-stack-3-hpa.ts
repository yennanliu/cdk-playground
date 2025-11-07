#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EksStack3HpaStack } from '../lib/eks-stack-3-hpa-stack';

const app = new cdk.App();
new EksStack3HpaStack(app, 'EksStack3HpaStack');
