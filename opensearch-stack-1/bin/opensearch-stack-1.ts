#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { OpensearchStack1Stack } from '../lib/opensearch-stack-1-stack';

const app = new cdk.App();
new OpensearchStack1Stack(app, 'OpensearchStack1Stack');
