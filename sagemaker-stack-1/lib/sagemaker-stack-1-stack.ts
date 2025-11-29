import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sagemaker from 'aws-cdk-lib/aws-sagemaker';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class SagemakerStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3 bucket for model artifacts
    const modelBucket = new s3.Bucket(this, 'ModelBucket', {
      bucketName: `sagemaker-house-price-model-${this.account}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
    });

    // SageMaker execution role
    const sagemakerRole = new iam.Role(this, 'SageMakerRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
      ],
    });

    // Grant S3 access to SageMaker role
    modelBucket.grantRead(sagemakerRole);

    // Grant access to AWS Deep Learning Container images in ECR
    // Note: AWS DLC images require specific ECR permissions
    sagemakerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
        ],
        resources: ['*'],
      })
    );

    // Also add the AmazonEC2ContainerRegistryReadOnly policy for ECR access
    sagemakerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly')
    );

    // SageMaker Model
    // Using AWS Deep Learning Container for sklearn
    const region = this.region;
    // Using sklearn 1.0-1 which is more widely available
    const sklearnImageUri = `763104351884.dkr.ecr.${region}.amazonaws.com/sklearn-inference:1.0-1-cpu-py3`;

    const model = new sagemaker.CfnModel(this, 'HousePriceModel', {
      executionRoleArn: sagemakerRole.roleArn,
      primaryContainer: {
        image: sklearnImageUri,
        modelDataUrl: `s3://${modelBucket.bucketName}/model.tar.gz`,
        environment: {
          SAGEMAKER_PROGRAM: 'inference.py',
          SAGEMAKER_SUBMIT_DIRECTORY: `/opt/ml/model/code`,
        },
      },
    });

    // SageMaker Endpoint Configuration
    const endpointConfig = new sagemaker.CfnEndpointConfig(this, 'EndpointConfig', {
      productionVariants: [
        {
          modelName: model.attrModelName,
          variantName: 'AllTraffic',
          initialInstanceCount: 1,
          instanceType: 'ml.t2.medium',
          initialVariantWeight: 1.0,
        },
      ],
    });
    endpointConfig.addDependency(model);

    // SageMaker Endpoint
    const endpoint = new sagemaker.CfnEndpoint(this, 'HousePriceEndpoint', {
      endpointConfigName: endpointConfig.attrEndpointConfigName,
      endpointName: 'house-price-predictor',
    });
    endpoint.addDependency(endpointConfig);

    // Lambda function for API handler
    // Note: Lambda code must be built first with: cd lambda && npm run build
    const predictLambda = new lambda.Function(this, 'PredictHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'predict-handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: Duration.seconds(30),
      environment: {
        ENDPOINT_NAME: endpoint.endpointName!,
        // AWS_REGION is automatically set by Lambda runtime
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant Lambda permission to invoke SageMaker endpoint
    predictLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sagemaker:InvokeEndpoint'],
        resources: [endpoint.ref],
      })
    );

    // API Gateway
    const api = new apigateway.RestApi(this, 'HousePriceApi', {
      restApiName: 'House Price Prediction API',
      description: 'API for house price predictions using SageMaker',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    // Add /predict endpoint
    const predict = api.root.addResource('predict');
    predict.addMethod('POST', new apigateway.LambdaIntegration(predictLambda));

    // Outputs
    new CfnOutput(this, 'ModelBucketName', {
      value: modelBucket.bucketName,
      description: 'S3 bucket for model artifacts',
    });

    new CfnOutput(this, 'SageMakerEndpointName', {
      value: endpoint.endpointName!,
      description: 'SageMaker endpoint name',
    });

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new CfnOutput(this, 'PredictEndpoint', {
      value: `${api.url}predict`,
      description: 'Full prediction endpoint URL',
    });
  }
}
