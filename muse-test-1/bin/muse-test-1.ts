#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest1Stack } from '../lib/muse-test-1-stack';

const app = new cdk.App();
new MuseTest1Stack(app, 'MuseTest1Stack');
