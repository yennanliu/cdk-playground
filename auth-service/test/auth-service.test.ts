import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as AuthService from '../lib/auth-service-stack';

describe('AuthServiceStack', () => {
  const app = new cdk.App();
  const stack = new AuthService.AuthServiceStack(app, 'TestAuthServiceStack');
  const template = Template.fromStack(stack);

  test('Cognito User Pool Created', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AutoVerifiedAttributes: ['email'],
    });
  });

  test('Cognito User Pool Client Created', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['implicit', 'code'],
    });
  });

  test('DynamoDB Table Created', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        {
          AttributeName: 'userId',
          KeyType: 'HASH',
        },
        {
          AttributeName: 'resource',
          KeyType: 'RANGE',
        },
      ],
      AttributeDefinitions: [
        {
          AttributeName: 'userId',
          AttributeType: 'S',
        },
        {
          AttributeName: 'resource',
          AttributeType: 'S',
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('Lambda Authorizer Created', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'authorizer.handler',
      Runtime: 'nodejs18.x',
    });
  });

  test('API Gateway Created', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'Auth Service API',
    });
  });

  test('API Gateway Method with Authorizer Created', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      AuthorizationType: 'CUSTOM',
    });
  });
});
