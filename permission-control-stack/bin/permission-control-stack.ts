#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PermissionControlStackStack } from '../lib/permission-control-stack-stack';

const app = new cdk.App();
new PermissionControlStackStack(app, 'PermissionControlStackStack');
