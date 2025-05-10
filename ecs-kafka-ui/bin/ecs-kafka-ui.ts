#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsKafkaUiStack } from '../lib/ecs-kafka-ui-stack';

const app = new cdk.App();
new EcsKafkaUiStack(app, 'EcsKafkaUiStack');
