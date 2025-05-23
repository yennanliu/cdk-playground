import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ApiGatewayLambdaTokenAuthorizer from '../lib/stack/api-gateway-lambda-token-authorizer-stack';

test('API Gateway Lambda Token Authorizer Stack Created', () => {
  const app = new cdk.App({
    context: {
      testing: true
    }
  });
  // WHEN
  const stack = new ApiGatewayLambdaTokenAuthorizer.ApiGatewayLambdaTokenAuthorizerStack(app, 'MyTestStack');
  // THEN

  const template = Template.fromStack(stack);

  // Test that Lambda functions are created
  template.resourceCountIs('AWS::Lambda::Function', 2);
  
  // Test that API Gateway is created
  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  
  // Test that Token Authorizer is created
  template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
  
  // Test that the authorizer has the correct type
  template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
    Type: 'TOKEN'
  });
  
  // Test that IAM roles are created for Lambda functions (at least 2)
  const iamRoles = template.findResources('AWS::IAM::Role');
  expect(Object.keys(iamRoles).length).toBeGreaterThanOrEqual(2);
  
  // Test that log groups are created (at least 1)
  const logGroups = template.findResources('AWS::Logs::LogGroup');
  expect(Object.keys(logGroups).length).toBeGreaterThanOrEqual(1);
});

test('Lambda Functions Have Correct Configuration', () => {
  const app = new cdk.App({
    context: {
      testing: true
    }
  });
  const stack = new ApiGatewayLambdaTokenAuthorizer.ApiGatewayLambdaTokenAuthorizerStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test operational lambda configuration
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs18.x',
    Handler: 'index.handler'
  });
});

test('API Gateway Has Correct Configuration', () => {
  const app = new cdk.App({
    context: {
      testing: true
    }
  });
  const stack = new ApiGatewayLambdaTokenAuthorizer.ApiGatewayLambdaTokenAuthorizerStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that deployment stage is 'dev'
  template.hasResourceProperties('AWS::ApiGateway::Deployment', {
    StageName: 'dev'
  });
});
