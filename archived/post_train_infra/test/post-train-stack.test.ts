import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { PostTrainStack } from '../lib/post-train-stack';

describe('PostTrainStack', () => {
  test('S3 Buckets Created', () => {
    const app = new cdk.App();
    const stack = new PostTrainStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Verify S3 buckets are created
    template.resourceCountIs('AWS::S3::Bucket', 3);
  });

  test('ECR Repositories Created', () => {
    const app = new cdk.App();
    const stack = new PostTrainStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Verify ECR repositories are created
    template.resourceCountIs('AWS::ECR::Repository', 4);
  });

  test('Secrets Created', () => {
    const app = new cdk.App();
    const stack = new PostTrainStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Verify secrets are created
    template.resourceCountIs('AWS::SecretsManager::Secret', 2);
  });

  test('IAM Roles Created for IRSA', () => {
    const app = new cdk.App();
    const stack = new PostTrainStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Verify IAM roles are created (4 IRSA roles)
    template.resourceCountIs('AWS::IAM::Role', 4);
  });

  test('EFS FileSystem Created', () => {
    const app = new cdk.App();
    const stack = new PostTrainStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Verify EFS is created
    template.resourceCountIs('AWS::EFS::FileSystem', 1);
  });

  test('CloudWatch Dashboard Created', () => {
    const app = new cdk.App();
    const stack = new PostTrainStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const template = Template.fromStack(stack);

    // Verify dashboard is created
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });
});
