#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AirflowEcs2Stack } from '../lib/airflow-ecs-2-stack';

const app = new cdk.App();
new AirflowEcs2Stack(app, 'AirflowEcs2Stack');
