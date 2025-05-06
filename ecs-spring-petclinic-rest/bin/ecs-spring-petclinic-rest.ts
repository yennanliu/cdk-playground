#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsSpringPetclinicRestStack } from '../lib/ecs-spring-petclinic-rest-stack';

const app = new cdk.App();
new EcsSpringPetclinicRestStack(app, 'EcsSpringPetclinicRestStack');
