import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export class ApiGatewayLambdaTokenAuthorizer1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Lambda function for token authorization
    const authorizerLambda = new lambda.Function(this, 'TokenAuthorizerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      code: lambda.Code.fromInline(`
        exports.handler = async function(event, context) {
          console.log('Received event:', JSON.stringify(event, null, 2));
          
          var token = event.authorizationToken;
          
          // Simple token validation logic
          switch (token) {
            case 'allow':
              return generatePolicy('user', 'Allow', event.methodArn);
            case 'deny':
              return generatePolicy('user', 'Deny', event.methodArn);
            case 'unauthorized':
              throw new Error('Unauthorized'); // Return a 401 Unauthorized response
            default:
              throw new Error('Error: Invalid token'); // Return a 500 Invalid token response
          }
        };

        // Helper function to generate an IAM policy
        function generatePolicy(principalId, effect, resource) {
          var authResponse = {};
          
          authResponse.principalId = principalId;
          if (effect && resource) {
            var policyDocument = {};
            policyDocument.Version = '2012-10-17'; 
            policyDocument.Statement = [];
            var statementOne = {};
            statementOne.Action = 'execute-api:Invoke'; 
            statementOne.Effect = effect;
            statementOne.Resource = resource;
            policyDocument.Statement[0] = statementOne;
            authResponse.policyDocument = policyDocument;
          }
          
          // Optional output with custom properties
          authResponse.context = {
            "stringKey": "stringval",
            "numberKey": 123,
            "booleanKey": true
          };
          return authResponse;
        }
      `)
    });

    // Lambda function for the protected API endpoint
    const apiLambda = new lambda.Function(this, 'ProtectedApiLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      code: lambda.Code.fromInline(`
        exports.handler = async function(event, context) {
          console.log('Received event:', JSON.stringify(event, null, 2));
          
          // Safely access authorizer context
          const requestContext = event?.requestContext || {};
          const authContext = requestContext?.authorizer || {};
          
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
              message: 'Hello from protected resource!',
              user: authContext.principalId || 'unknown',
              context: authContext
            })
          };
        };
      `)
    });

    // Create the Token Authorizer
    const tokenAuthorizer = new apigateway.TokenAuthorizer(this, 'TokenAuthorizer', {
      handler: authorizerLambda,
      identitySource: apigateway.IdentitySource.header('Authorization'),
      resultsCacheTtl: Duration.seconds(0) // Disable caching for testing
    });

    // Create the REST API
    const api = new apigateway.RestApi(this, 'TokenAuthApi', {
      restApiName: 'Token Authorization API',
      description: 'Simple API with Lambda Token Authorizer',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      }
    });

    // Create API resources and methods
    
    // Public endpoint (no authorization)
    const publicResource = api.root.addResource('public');
    publicResource.addMethod('GET', new apigateway.LambdaIntegration(
      new lambda.Function(this, 'PublicApiLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline(`
          exports.handler = async function(event, context) {
            return {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              },
              body: JSON.stringify({
                message: 'Hello from public endpoint! No authorization required.'
              })
            };
          };
        `)
      })
    ));

    // Protected endpoint (requires authorization)
    const protectedResource = api.root.addResource('protected');
    protectedResource.addMethod('GET', new apigateway.LambdaIntegration(apiLambda), {
      authorizer: tokenAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM
    });

    // Another protected endpoint for testing
    const usersResource = api.root.addResource('users');
    usersResource.addMethod('GET', new apigateway.LambdaIntegration(
      new lambda.Function(this, 'UsersApiLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline(`
          exports.handler = async function(event, context) {
            console.log('Received event:', JSON.stringify(event, null, 2));
            
            // Safely access authorizer context
            const requestContext = event?.requestContext || {};
            const authContext = requestContext?.authorizer || {};
            
            return {
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              },
              body: JSON.stringify({
                message: 'Users endpoint accessed successfully!',
                users: [
                  { id: 1, name: 'John Doe' },
                  { id: 2, name: 'Jane Smith' }
                ],
                authorizedUser: authContext.principalId || 'unknown'
              })
            };
          };
        `)
      })
    ), {
      authorizer: tokenAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM
    });

    // Output the API URL for testing
    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL'
    });
  }
}
