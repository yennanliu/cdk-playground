#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { OllamaStack1Stack } from '../lib/ollama-stack-1-stack';

const app = new cdk.App();
new OllamaStack1Stack(app, 'OllamaStack1Stack');
