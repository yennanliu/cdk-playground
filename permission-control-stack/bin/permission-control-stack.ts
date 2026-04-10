#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PermissionControlStack } from '../lib/permission-control-stack-stack';

const app = new cdk.App();
new PermissionControlStack(app, 'PermissionControlStack');
