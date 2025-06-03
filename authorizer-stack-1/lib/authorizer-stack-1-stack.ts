import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';

export class AuthorizerStack1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. DynamoDB Table for Users
    const userTable = new dynamodb.Table(this, 'UserTable', {
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For demo/dev only, use RETAIN in prod
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // 2. Secrets Manager: JWT signing secret
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      description: 'HMAC secret for signing JWT tokens',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'jwtSecret',
        passwordLength: 32,
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. Lambda Function for Auth and Members API
    const authLambda = new lambdaNodejs.NodejsFunction(this, 'AuthLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, 'lambda', 'auth-handler.ts'), // We'll write this file separately
      handler: 'handler',
      environment: {
        USER_TABLE_NAME: userTable.tableName,
        JWT_SECRET_ARN: jwtSecret.secretArn,
      },
      timeout: cdk.Duration.seconds(15),
    });

    // Grant Lambda permissions
    userTable.grantReadWriteData(authLambda);
    jwtSecret.grantRead(authLambda);

    // 4. API Gateway REST API
    const api = new apigateway.RestApi(this, 'AuthApiGateway', {
      restApiName: 'Auth API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Proxy /auth and /members to Lambda
    const proxyIntegration = new apigateway.LambdaIntegration(authLambda);

    // /auth resource
    const authResource = api.root.addResource('auth');
    authResource.addProxy({
      defaultIntegration: proxyIntegration,
      anyMethod: true,
    });

    // /members resource
    const membersResource = api.root.addResource('members');
    membersResource.addProxy({
      defaultIntegration: proxyIntegration,
      anyMethod: true,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });
  }
}
