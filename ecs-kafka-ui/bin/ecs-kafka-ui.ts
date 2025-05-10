#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EcsKafkaUiStack } from '../lib/ecs-kafka-ui-stack';

const app = new cdk.App();

// Demo stack with no Kafka clusters (will use dynamic configuration)
new EcsKafkaUiStack(app, 'EcsKafkaUiDemoStack', {
  dynamicConfigEnabled: true,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Uncomment the following to deploy with predefined Kafka clusters
/*
new EcsKafkaUiStack(app, 'EcsKafkaUiProdStack', {
  dynamicConfigEnabled: false,
  kafkaClusters: [
    {
      name: 'production-cluster',
      bootstrapServers: 'kafka-broker1:9092,kafka-broker2:9092,kafka-broker3:9092',
      schemaRegistry: 'http://schema-registry:8081',
      properties: {
        securityProtocol: 'SASL_SSL',
        saslMechanism: 'PLAIN',
      },
    },
    {
      name: 'staging-cluster',
      bootstrapServers: 'kafka-staging:9092',
    },
  ],
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
*/
