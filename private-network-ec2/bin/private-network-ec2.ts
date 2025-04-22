#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PrivateNetworkEc2Stack } from '../lib/private-network-ec2-stack';

const app = new cdk.App();
new PrivateNetworkEc2Stack(app, 'PrivateNetworkEc2Stack');
