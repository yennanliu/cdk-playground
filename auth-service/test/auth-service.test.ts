import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as AuthService from '../lib/auth-service-stack';

describe('AuthServiceStack', () => {
  const app = new cdk.App();
  const stack = new AuthService.AuthServiceStack(app, 'TestAuthServiceStack');
  const template = Template.fromStack(stack);

  test('Cognito User Pool Created', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AutoVerifyAttributes: ['email'],
      UsernameAttributes: undefined,
      VerificationMessageTemplate: undefined,
    });
  });

  test('Cognito User Pool Client Created', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      UserPoolId: {
        Ref: expect.stringMatching(/^AuthServiceUserPool[A-Z0-9]+$/),
      },
      GenerateSecret: false,
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
      AuthorizerId: {
        Ref: expect.stringMatching(/^TokenAuthorizer[A-Z0-9]+$/),
      },
    });
  });
});
