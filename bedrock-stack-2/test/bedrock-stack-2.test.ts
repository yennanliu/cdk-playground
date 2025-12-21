import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as BedrockStack2 from '../lib/bedrock-stack-2-stack';

test('Lambda Function Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new BedrockStack2.BedrockStack2Stack(app, 'MyTestStack');
  // THEN

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs20.x',
    Handler: 'resumeUpdater.handler',
    Timeout: 60,
    MemorySize: 1024
  });
});

test('API Gateway Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new BedrockStack2.BedrockStack2Stack(app, 'MyTestStack');
  // THEN

  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
});

test('Lambda Has Bedrock Permissions', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new BedrockStack2.BedrockStack2Stack(app, 'MyTestStack');
  // THEN

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'bedrock:InvokeModel',
          Effect: 'Allow'
        })
      ])
    }
  });
});
