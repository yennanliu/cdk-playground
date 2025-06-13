#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VideoUploadPlayerStack1Stack } from '../lib/video-upload-player-stack-1-stack';

const app = new cdk.App();
new VideoUploadPlayerStack1Stack(app, 'VideoUploadPlayerStack1Stack');
