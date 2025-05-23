import * as path from 'path'
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";


export class ApiGatewayLambdaTokenAuthorizerStack extends cdk.Stack {

  //super(scope, id, props);

  // const queue = new sqs.Queue(this, 'ApiGatewayLambdaTokenAuthorizerQueue', {
  //   visibilityTimeout: Duration.seconds(300)
  // });

  // const topic = new sns.Topic(this, 'ApiGatewayLambdaTokenAuthorizerTopic');

  // topic.addSubscription(new subs.SqsSubscription(queue));

  readonly operationalLambda: cdk.aws_lambda.IFunction;
  readonly authorizerLambda: cdk.aws_lambda.IFunction;
  readonly restApi: cdk.aws_apigateway.LambdaRestApi;

  readonly operationalEntryPath = path.join(__dirname, "../lambdas/operational/index.ts")
  readonly authLambdaEntryPath = path.join(__dirname, "../lambdas/authorizer/index.ts")

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /** Creating operational Lambda, which server the request */
    this.operationalLambda = this.getOperationalFunction();

    /** Lambda, which takes incoming request and checks the authorization and authentication */
    this.authorizerLambda = this.getLambdaAuthFunction();

    /** Generating Token Authorization, which will be injected to API Gateway */
    const lambdaTokenAuthorizer = this.getTokenAuthorizer(this.authorizerLambda)

    /** Creating Lambda Rest API, which integrates Endpoint to Lambda */
    this.restApi = this.createRestApi(this.operationalLambda, lambdaTokenAuthorizer);

    /** Creating /health resource at root for lambda Rest API */
    const healthResource = this.restApi.root.addResource("health");
    healthResource.addMethod("GET");

    /** Creating /protected resource that requires authorization */
    const protectedResource = this.restApi.root.addResource("protected");
    protectedResource.addMethod("GET");
    protectedResource.addMethod("POST");

    /** Returning Output with URL made as part of lambdaRestApi */
    new cdk.CfnOutput(this, "apiUrl", { 
      value: this.restApi.url,
      description: "API Gateway URL"
    });

    new cdk.CfnOutput(this, "healthEndpoint", {
      value: `${this.restApi.url}health`,
      description: "Health check endpoint"
    });

    new cdk.CfnOutput(this, "protectedEndpoint", {
      value: `${this.restApi.url}protected`,
      description: "Protected endpoint requiring authorization"
    });
  }


  private getOperationalFunction(): cdk.aws_lambda.IFunction {
    // Use inline code for consistent deployment without Docker dependency
    return new cdk.aws_lambda.Function(this, "operational-lambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: cdk.aws_lambda.Code.fromInline(`
        exports.handler = async (event, context) => {
            console.log('Event:', JSON.stringify(event, null, 2));
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
                },
                body: JSON.stringify({
                    message: 'Healthy',
                    timestamp: new Date().toISOString(),
                    path: event.path,
                    method: event.httpMethod
                })
            };
        };
      `),
      description: 'Operational Lambda that serves protected endpoints',
      logRetention: cdk.aws_logs.RetentionDays.ONE_DAY,
      memorySize: 512,
      timeout: cdk.Duration.minutes(2),
    });
  }


  /**
   * Creating Authorization Lambda, to validate incoming request
   *
   * @private
   * @return {*}  {cdk.aws_lambda.IFunction}
   * @memberof ApiGatewayLambdaTokenAuthorizerStack
   */
  private getLambdaAuthFunction(): cdk.aws_lambda.IFunction {
    return new cdk.aws_lambda.Function(this, "authentication-lambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: cdk.aws_lambda.Code.fromInline(`
        exports.handler = function (event, context, callback) {
            console.log('Authorizer event:', JSON.stringify(event, null, 2));
            
            let token = event.authorizationToken;
            
            // Remove 'Bearer ' prefix if present
            if (token && token.startsWith('Bearer ')) {
                token = token.substring(7);
            }
            
            const generatePolicy = function (principalId, effect, resource) {
                return {
                    principalId: principalId,
                    policyDocument: {
                        Version: '2012-10-17',
                        Statement: [{
                            Action: 'execute-api:Invoke',
                            Effect: effect,
                            Resource: resource
                        }]
                    },
                    context: {
                        // You can add additional context here that will be passed to your Lambda
                        tokenValidated: 'true',
                        userId: principalId,
                        timestamp: new Date().toISOString()
                    }
                };
            };
            
            try {
                // Simple token validation logic
                // In a real scenario, you would validate JWT tokens, check against a database, etc.
                switch (token) {
                    case 'allow':
                    case 'valid-token-123':
                        console.log('Token valid, allowing access');
                        callback(null, generatePolicy('user', 'Allow', event.methodArn));
                        break;
                    case 'deny':
                    case 'invalid-token':
                        console.log('Token invalid, denying access');
                        callback(null, generatePolicy('user', 'Deny', event.methodArn));
                        break;
                    case 'unauthorized':
                        console.log('Unauthorized token');
                        callback("Unauthorized");   // Return a 401 Unauthorized response
                        break;
                    default:
                        // For any other token, we can check if it's a valid format
                        if (token && token.length > 10 && token.includes('-')) {
                            // Simple heuristic for token validation
                            console.log('Token appears valid, allowing access');
                            callback(null, generatePolicy('user', 'Allow', event.methodArn));
                        } else {
                            console.log('Invalid token format');
                            callback("Error: Invalid token"); // Return a 500 Invalid token response
                        }
                }
            } catch (error) {
                console.error('Error processing authorization:', error);
                callback("Error: Authorization failed");
            }
        };
      `),
      description: 'Lambda Authorizer that validates tokens',
      logRetention: cdk.aws_logs.RetentionDays.ONE_DAY,
      memorySize: 512,
      timeout: cdk.Duration.minutes(2),
    });
  }


  /**
   * Creating Token Authorizer, to inject auth-lambda into Rest API Gateway
   *
   * @private
   * @param {IFunction} authorizerLambda
   * @return {*}  {cdk.aws_apigateway.TokenAuthorizer}
   * @memberof ApiGatewayLambdaTokenAuthorizerStack
   */
  private getTokenAuthorizer(authorizerLambda: cdk.aws_lambda.IFunction): cdk.aws_apigateway.TokenAuthorizer {
    return new cdk.aws_apigateway.TokenAuthorizer(
      this,
      "operationalAuthorizer",
      {
        handler: authorizerLambda,
        resultsCacheTtl: cdk.Duration.minutes(5), // Cache authorization for 5 minutes
      }
    );
  }


  /**
   * Creating Lambda Rest API, that integrates API to Operational Lambda with Token Authorizer
   *
   * @private
   * @param {cdk.aws_lambda.IFunction} operationalLambda
   * @param {cdk.aws_apigateway.TokenAuthorizer} lambdaAuthorizer
   * @return {*}  {cdk.aws_apigateway.LambdaRestApi}
   * @memberof ApiGatewayLambdaTokenAuthorizerStack
   */
  private createRestApi(
    operationalLambda: cdk.aws_lambda.IFunction,
    lambdaAuthorizer: cdk.aws_apigateway.TokenAuthorizer
  ): cdk.aws_apigateway.LambdaRestApi {
    // Create API Gateway CloudWatch role
    const apiGatewayCloudWatchRole = new cdk.aws_iam.Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')
      ]
    });

    // Set the CloudWatch role for API Gateway (this is account-level, but CDK handles it)
    const account = new cdk.aws_apigateway.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGatewayCloudWatchRole.roleArn
    });

    const logGroup = this.createApiGatewayAccessLogsGroup(this);
    const api = new cdk.aws_apigateway.LambdaRestApi(this, "rest-api-gateway", {
      handler: operationalLambda,
      proxy: false,
      deployOptions: {
        stageName: "dev",
        accessLogDestination: new cdk.aws_apigateway.LogGroupLogDestination(
          logGroup
        ),
        accessLogFormat:
          cdk.aws_apigateway.AccessLogFormat.jsonWithStandardFields(),
      },
      defaultMethodOptions: {
        authorizer: lambdaAuthorizer,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: cdk.aws_apigateway.Cors.ALL_ORIGINS,
        allowMethods: cdk.aws_apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
    });

    // Ensure the account is created before the API
    api.node.addDependency(account);

    return api;
  }


  /**
   * Creating Access-log Group, for API Gateway
   *
   * @private
   * @param {Construct} scope
   * @return {*}  {cdk.aws_logs.ILogGroup}
   * @memberof ApiGatewayLambdaTokenAuthorizerStack
   */
  private createApiGatewayAccessLogsGroup(
    scope: Construct
  ): cdk.aws_logs.ILogGroup {
    const logGroupName = "apigateway-auth-lambda";
    const logRetention = new cdk.aws_logs.LogRetention(
      scope,
      "apiGwLogGroupConstruct",
      {
        logGroupName: logGroupName,
        retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );
    const logGroup = cdk.aws_logs.LogGroup.fromLogGroupArn(
      scope,
      "apiGwLogGroup",
      logRetention.logGroupArn
    );
    return logGroup;
  }
}


