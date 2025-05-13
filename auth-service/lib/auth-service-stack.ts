import { Stack } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

export class AuthServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Cognito User Pool
    const userPool = new cognito.UserPool(this, 'AuthServiceUserPool', {
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development only, use RETAIN for production
    });

    // Create User Pool Client
    const userPoolClient = new cognito.UserPoolClient(this, 'AuthServiceUserPoolClient', {
      userPool,
      generateSecret: false, // Set to true if using a server-side application
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:3000/callback'], // Replace with your app's callback URLs
        logoutUrls: ['http://localhost:3000/logout'],     // Replace with your app's logout URLs
      },
    });

    // Create a DynamoDB table for user permissions (RBAC)
    const permissionsTable = new dynamodb.Table(this, 'UserPermissionsTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'resource', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development only, use RETAIN for production
    });

    // Create Lambda Authorizer
    const authorizerLambda = new lambda.Function(this, 'AuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'authorizer.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
        PERMISSIONS_TABLE: permissionsTable.tableName,
      },
    });

    // Grant permissions to the Lambda to access the DynamoDB table
    permissionsTable.grantReadData(authorizerLambda);

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'AuthServiceApi', {
      restApiName: 'Auth Service API',
      description: 'API for the Auth Service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Create Lambda Authorizer for API Gateway
    const tokenAuthorizer = new apigateway.TokenAuthorizer(this, 'TokenAuthorizer', {
      handler: authorizerLambda,
      identitySource: 'method.request.header.Authorization',
    });

    // Create a protected resource
    const secureResource = api.root.addResource('secure');
    
    // Create a Lambda function for the secure endpoint
    const secureEndpointLambda = new lambda.Function(this, 'SecureEndpointFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'secure-endpoint.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
    });

    // Add the secure endpoint with the authorizer
    secureResource.addMethod('GET', new apigateway.LambdaIntegration(secureEndpointLambda), {
      authorizer: tokenAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });

    // Output important information
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'The ID of the Cognito User Pool',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'The ID of the Cognito User Pool Client',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'The URL of the API Gateway',
    });

    new cdk.CfnOutput(this, 'PermissionsTableName', {
      value: permissionsTable.tableName,
      description: 'The name of the DynamoDB Permissions Table',
    });
  }
}
