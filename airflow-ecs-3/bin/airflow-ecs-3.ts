#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AirflowEcs3Stack } from '../lib/airflow-ecs-3-stack';

const app = new cdk.App();
new AirflowEcs3Stack(app, 'AirflowEcs3Stack-8');
