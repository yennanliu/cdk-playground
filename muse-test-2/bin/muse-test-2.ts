#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest2Stack } from '../lib/muse-test-2-stack';

const app = new cdk.App();
new MuseTest2Stack(app, 'MuseTest2Stack');
