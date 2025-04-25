#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GitlabDeploymentStack } from '../lib/gitlab-deployment-stack';

const app = new cdk.App();
new GitlabDeploymentStack(app, 'GitlabDeploymentStack');
