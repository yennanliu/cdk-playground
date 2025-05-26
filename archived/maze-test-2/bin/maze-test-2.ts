#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MazeTest2Stack } from '../lib/maze-test-2-stack';

const app = new cdk.App();
new MazeTest2Stack(app, 'MazeTest2Stack');
