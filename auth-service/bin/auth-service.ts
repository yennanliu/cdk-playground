#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthServiceStack } from '../lib/auth-service-stack';

const app = new cdk.App();
new AuthServiceStack(app, 'AuthServiceStack');
