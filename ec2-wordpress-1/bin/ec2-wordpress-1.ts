#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Ec2Wordpress1Stack } from '../lib/ec2-wordpress-1-stack';

const app = new cdk.App();
new Ec2Wordpress1Stack(app, 'Ec2Wordpress1Stack');
