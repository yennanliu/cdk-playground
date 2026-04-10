import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { PermissionControlStack } from '../lib/permission-control-stack-stack';

test('Stack creates DynamoDB tables', () => {
  const app = new cdk.App();
  const stack = new PermissionControlStack(app, 'PermissionControlStack');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::DynamoDB::Table', 3);
});

test('Stack creates 3 application Lambda functions', () => {
  const app = new cdk.App();
  const stack = new PermissionControlStack(app, 'PermissionControlStack');
  const template = Template.fromStack(stack);

  // 3 application Lambdas + 1 CloudWatch logging Lambda for API Gateway
  template.resourceCountIs('AWS::Lambda::Function', 4);
});

test('Stack creates API Gateway', () => {
  const app = new cdk.App();
  const stack = new PermissionControlStack(app, 'PermissionControlStack');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
});

test('Stack creates S3 bucket with public access blocked', () => {
  const app = new cdk.App();
  const stack = new PermissionControlStack(app, 'PermissionControlStack');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    }
  });
});
