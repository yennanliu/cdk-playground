import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ImgRecogApp1 from '../lib/img_recog_app-1-stack';
import { StorageStack } from '../lib/storage-stack';
import { ApiStack } from '../lib/api-stack';

test('Image Recognition Main Stack Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new ImgRecogApp1.ImgRecogApp1Stack(app, 'MyTestStack');
  // THEN

  const template = Template.fromStack(stack);

  // Test outputs exist
  template.hasOutput('ApiEndpoint', {});
  template.hasOutput('ImageBucketName', {});
  template.hasOutput('ResultsTableName', {});
});

test('Storage Stack Resources', () => {
  const app = new cdk.App();
  // WHEN
  const storageStack = new StorageStack(app, 'StorageTestStack');
  // THEN

  const template = Template.fromStack(storageStack);

  // Test S3 bucket exists
  template.resourceCountIs('AWS::S3::Bucket', 1);

  // Test DynamoDB table exists
  template.resourceCountIs('AWS::DynamoDB::Table', 1);
});

test('API Stack Resources', () => {
  const app = new cdk.App();
  const storageStack = new StorageStack(app, 'StorageTestStack');

  // WHEN
  const apiStack = new ApiStack(app, 'ApiTestStack', {
    imageBucket: storageStack.imageBucket,
    resultsTable: storageStack.resultsTable,
  });
  // THEN

  const template = Template.fromStack(apiStack);

  // Test Lambda function exists
  template.resourceCountIs('AWS::Lambda::Function', 1);

  // Test API Gateway exists
  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);

  // Test IAM role for Lambda exists (at least 1)
  template.resourceCountIs('AWS::IAM::Role', 2);
});
