#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsGitbucket1Stack } from '../lib/ecs-gitbucket-1-stack';

const app = new cdk.App();
new EcsGitbucket1Stack(app, 'EcsGitbucket1Stack');
