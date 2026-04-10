import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import { Construct } from 'constructs';

export class PermissionControlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ─── DynamoDB Tables ───

    const hierarchyTable = new dynamodb.Table(this, 'EmployeeHierarchy', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    hierarchyTable.addGlobalSecondaryIndex({
      indexName: 'phone-index',
      partitionKey: { name: 'phone', type: dynamodb.AttributeType.STRING },
    });

    const roleTable = new dynamodb.Table(this, 'Roles', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const roleAssignmentTable = new dynamodb.Table(this, 'RoleAssignments', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ─── S3 Bucket ───

    const datasetBucket = new s3.Bucket(this, 'DatasetBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ─── Lambda Functions ───

    const lambdaDir = path.join(__dirname, '..', 'dist', 'lambda');

    const authFn = new lambda.Function(this, 'AuthFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'auth/index.handler',
      code: lambda.Code.fromAsset(lambdaDir),
      environment: {
        HIERARCHY_TABLE: hierarchyTable.tableName,
        JWT_SECRET: 'change-me-use-secrets-manager',
      },
    });
    hierarchyTable.grantReadData(authFn);

    const hierarchyFn = new lambda.Function(this, 'HierarchyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'hierarchy/index.handler',
      code: lambda.Code.fromAsset(lambdaDir),
      environment: {
        HIERARCHY_TABLE: hierarchyTable.tableName,
        ROLE_TABLE: roleTable.tableName,
        ROLE_ASSIGNMENT_TABLE: roleAssignmentTable.tableName,
        JWT_SECRET: 'change-me-use-secrets-manager',
      },
    });
    hierarchyTable.grantReadWriteData(hierarchyFn);
    roleTable.grantReadWriteData(hierarchyFn);
    roleAssignmentTable.grantReadWriteData(hierarchyFn);

    const datasetFn = new lambda.Function(this, 'DatasetFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dataset/index.handler',
      code: lambda.Code.fromAsset(lambdaDir),
      environment: {
        ROLE_TABLE: roleTable.tableName,
        ROLE_ASSIGNMENT_TABLE: roleAssignmentTable.tableName,
        DATASET_BUCKET: datasetBucket.bucketName,
        JWT_SECRET: 'change-me-use-secrets-manager',
      },
    });
    roleTable.grantReadData(datasetFn);
    roleAssignmentTable.grantReadData(datasetFn);
    datasetBucket.grantReadWrite(datasetFn);

    // ─── API Gateway ───

    const api = new apigateway.RestApi(this, 'PermissionControlApi', {
      restApiName: 'Permission Control API',
      deployOptions: { stageName: 'v1' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // /auth/verify
    const auth = api.root.addResource('auth');
    auth.addResource('verify').addMethod('POST', new apigateway.LambdaIntegration(authFn));

    // /hierarchy
    const hierarchy = api.root.addResource('hierarchy');
    hierarchy.addMethod('GET', new apigateway.LambdaIntegration(hierarchyFn));
    hierarchy.addResource('departments').addMethod('POST', new apigateway.LambdaIntegration(hierarchyFn));
    const teams = hierarchy.addResource('teams');
    teams.addMethod('GET', new apigateway.LambdaIntegration(hierarchyFn));
    teams.addMethod('POST', new apigateway.LambdaIntegration(hierarchyFn));
    const employees = hierarchy.addResource('employees');
    employees.addMethod('GET', new apigateway.LambdaIntegration(hierarchyFn));
    employees.addMethod('POST', new apigateway.LambdaIntegration(hierarchyFn));

    // /roles
    const roles = api.root.addResource('roles');
    roles.addMethod('GET', new apigateway.LambdaIntegration(hierarchyFn));
    roles.addMethod('POST', new apigateway.LambdaIntegration(hierarchyFn));
    const assign = roles.addResource('assign');
    assign.addMethod('POST', new apigateway.LambdaIntegration(hierarchyFn));
    assign.addMethod('DELETE', new apigateway.LambdaIntegration(hierarchyFn));

    // /permissions
    const permissions = api.root.addResource('permissions');
    permissions.addMethod('GET', new apigateway.LambdaIntegration(hierarchyFn));

    // /datasets
    const datasets = api.root.addResource('datasets');
    datasets.addMethod('GET', new apigateway.LambdaIntegration(datasetFn));
    const dataset = datasets.addResource('{id}');
    dataset.addMethod('GET', new apigateway.LambdaIntegration(datasetFn));
    dataset.addMethod('PUT', new apigateway.LambdaIntegration(datasetFn));

    // ─── UI Static Website ───

    const uiBucket = new s3.Bucket(this, 'UiBucket', {
      websiteIndexDocument: 'index.html',
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        ignorePublicAcls: false,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3deploy.BucketDeployment(this, 'DeployUi', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', 'ui')),
        s3deploy.Source.jsonData('config.json', {
          apiUrl: api.url.replace(/\/$/, ''),
        }),
      ],
      destinationBucket: uiBucket,
    });

    new CfnOutput(this, 'UiUrl', {
      value: uiBucket.bucketWebsiteUrl,
      description: 'Permission Control UI',
    });
  }
}
