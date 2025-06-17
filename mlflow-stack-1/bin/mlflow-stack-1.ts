#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MlflowStack1Stack } from '../lib/mlflow-stack-1-stack';

const app = new cdk.App();
new MlflowStack1Stack(app, 'MlflowStack1Stack');
