#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsStack } from '../lib/ecs-stack';
import { NetworkStack } from '../lib/network-stack';

const app = new cdk.App();

// Create the network stack
const networkStack = new NetworkStack(app, 'NetworkStack');

// Pass the VPC from the network stack to the ECS stack
new EcsStack(app, 'EcsWordpress1Stack', { vpc: networkStack.vpc });
