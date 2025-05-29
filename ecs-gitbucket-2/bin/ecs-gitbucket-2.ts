#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsGitbucket2Stack } from '../lib/ecs-gitbucket-2-stack';

const app = new cdk.App();
new EcsGitbucket2Stack(app, 'EcsGitbucket2Stack');
