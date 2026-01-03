#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { YtStreamStack1Stack } from '../lib/yt-stream-stack-1-stack';

const app = new cdk.App();
new YtStreamStack1Stack(app, 'YtStreamStack1Stack');
