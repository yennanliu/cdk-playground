#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AiMusicGenStack1Stack } from '../lib/ai-music-gen-stack-1-stack';

const app = new cdk.App();
new AiMusicGenStack1Stack(app, 'AiMusicGenStack1Stack');
