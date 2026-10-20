#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MuseTest5Stack } from '../lib/muse-test-5-stack';

const app = new cdk.App();
new MuseTest5Stack(app, 'MuseTest5Stack');
