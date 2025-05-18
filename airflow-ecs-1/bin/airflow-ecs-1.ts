#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AirflowEcs1Stack } from '../lib/airflow-ecs-1-stack';

const app = new cdk.App();
new AirflowEcs1Stack(app, 'AirflowEcs1Stack');
