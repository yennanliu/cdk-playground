#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
//import { MlflowStack1Stack } from '../lib/mlflow-stack-1-stack';
import { MlflowEcsStack } from '../lib/MlflowStack1Stack-2';


const app = new cdk.App();
//new MlflowStack1Stack(app, 'MlflowStack1Stack-6');
new MlflowEcsStack(app, 'MlflowStack1Stack-7');
