#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GitlabDeploymentV2Stack } from '../lib/gitlab-deployment-v2-stack';

const app = new cdk.App();
new GitlabDeploymentV2Stack(app, 'GitlabDeploymentV2Stack');
