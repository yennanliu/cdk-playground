import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { Construct } from 'constructs';

export class AuthorizerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // DynamoDB table for users
        const usersTable = new dynamodb.Table(this, 'UsersTable', {
            partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development only
        });

        // JWT Secret in Secrets Manager
        const jwtSecret = new secretsmanager.Secret(this, 'JWTSecret', {
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ secret: '' }),
                generateStringKey: 'secret',
                excludePunctuation: true,
                includeSpace: false,
                passwordLength: 32,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development only
        });

        // Lambda function for API logic
        // const apiHandler = new lambda.Function(this, 'ApiHandler', {
        //   runtime: lambda.Runtime.NODEJS_18_X,
        //   handler: 'index.handler',
        //   code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
        //   environment: {
        //     USERS_TABLE: usersTable.tableName,
        //     JWT_SECRET_ARN: jwtSecret.secretArn,
        //   },
        //   timeout: cdk.Duration.seconds(30),
        // });

        const apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, 'lambda/auth-handler.ts'),
            environment: {
                USERS_TABLE: usersTable.tableName,
                JWT_SECRET_ARN: jwtSecret.secretArn,
            },
            timeout: cdk.Duration.seconds(60),
            bundling: {
                minify: true,
                sourceMap: true,
                externalModules: [
                    '@aws-sdk/*', // Don't bundle AWS SDK v3 modules as they're available in the Lambda runtime
                ],
            },
        });

        // Grant Lambda permissions
        usersTable.grantReadWriteData(apiHandler);
        jwtSecret.grantRead(apiHandler);

        // API Gateway
        const api = new apigateway.RestApi(this, 'AuthApi', {
            restApiName: 'User Authorization API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });

        // Auth endpoints
        const authResource = api.root.addResource('auth');
        const loginResource = authResource.addResource('login');
        loginResource.addMethod('POST', new apigateway.LambdaIntegration(apiHandler));

        const verifyResource = authResource.addResource('verify');
        verifyResource.addMethod('POST', new apigateway.LambdaIntegration(apiHandler));

        // Members endpoints
        const membersResource = api.root.addResource('members');
        membersResource.addMethod('GET', new apigateway.LambdaIntegration(apiHandler));
        membersResource.addMethod('POST', new apigateway.LambdaIntegration(apiHandler));

        const memberResource = membersResource.addResource('{email}');
        memberResource.addMethod('DELETE', new apigateway.LambdaIntegration(apiHandler));

        // Add password update endpoint
        const passwordResource = membersResource.addResource('password');
        passwordResource.addMethod('PUT', new apigateway.LambdaIntegration(apiHandler));

        // S3 bucket for static website
        const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
            websiteIndexDocument: 'index.html',
            publicReadAccess: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true, // Enable automatic deletion of objects when bucket is destroyed
        });

        // Deploy website files
        new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../frontend'))],
            destinationBucket: websiteBucket,
        });

        // Output values
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url,
            description: 'API Gateway endpoint URL',
        });

        new cdk.CfnOutput(this, 'WebsiteUrl', {
            value: websiteBucket.bucketWebsiteUrl,
            description: 'Website URL',
        });
    }
}
