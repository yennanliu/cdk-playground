import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { AgentTeamStack } from '../lib/agent-team-stack';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new AgentTeamStack(app, 'TestAgentTeamStack');
  template = Template.fromStack(stack);
});

test('three Lambda functions created (PM, Backend, Frontend)', () => {
  template.resourceCountIs('AWS::Lambda::Function', 3);
});

test('two SQS queues created (Backend, Frontend)', () => {
  template.resourceCountIs('AWS::SQS::Queue', 2);
  template.hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 300 });
});

test('DynamoDB table created with correct key schema', () => {
  template.resourceCountIs('AWS::DynamoDB::Table', 1);
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    KeySchema: [
      { AttributeName: 'taskId', KeyType: 'HASH' },
      { AttributeName: 'agentRole', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  });
});

test('PM Lambda has Function URL', () => {
  template.resourceCountIs('AWS::Lambda::Url', 1);
  template.hasResourceProperties('AWS::Lambda::Url', {
    AuthType: 'AWS_IAM',
  });
});
