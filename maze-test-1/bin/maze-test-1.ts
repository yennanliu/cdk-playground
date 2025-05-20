#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MazeTest1Stack } from '../lib/maze-test-1-stack';

const app = new cdk.App();
new MazeTest1Stack(app, 'MazeTest1Stack');
