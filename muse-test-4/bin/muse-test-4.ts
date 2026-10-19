#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest4Stack } from '../lib/muse-test-4-stack';

const app = new cdk.App();
new MuseTest4Stack(app, 'MuseTest4Stack');
