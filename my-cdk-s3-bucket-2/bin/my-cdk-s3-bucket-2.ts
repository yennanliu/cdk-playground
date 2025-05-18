#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MyCdkS3Bucket2Stack } from '../lib/my-cdk-s3-bucket-2-stack';

const app = new cdk.App();
new MyCdkS3Bucket2Stack(app, 'MyCdkS3Bucket2Stack');
