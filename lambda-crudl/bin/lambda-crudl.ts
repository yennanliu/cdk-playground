#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LambdaCrudlStack } from '../lib/lambda-crudl-stack';

const app = new cdk.App();
new LambdaCrudlStack(app, 'LambdaCrudlStack');
