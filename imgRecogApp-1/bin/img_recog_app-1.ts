#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ImgRecogApp1Stack } from '../lib/img_recog_app-1-stack';

const app = new cdk.App();
new ImgRecogApp1Stack(app, 'ImgRecogApp1Stack');
