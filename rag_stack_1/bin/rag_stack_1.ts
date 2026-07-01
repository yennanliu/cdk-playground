#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { RagStack1Stack } from '../lib/rag_stack_1-stack';

const app = new cdk.App();
new RagStack1Stack(app, 'RagStack1Stack');
