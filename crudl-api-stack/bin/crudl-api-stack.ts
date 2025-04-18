#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CrudlApiStackStack } from '../lib/crudl-api-stack-stack';

const app = new cdk.App();
new CrudlApiStackStack(app, 'CrudlApiStackStack');
