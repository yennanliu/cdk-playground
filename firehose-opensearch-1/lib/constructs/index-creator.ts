import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Duration, CustomResource } from 'aws-cdk-lib';
import { OpenSearchServerlessConstruct } from './opensearch-serverless';

export interface IndexCreatorConstructProps {
  readonly openSearchConstruct: OpenSearchServerlessConstruct;
  readonly indexName: string;
  readonly vectorFieldName: string;
  readonly vectorDimension?: number;
}

export class IndexCreatorConstruct extends Construct {
  public readonly indexName: string;

  constructor(scope: Construct, id: string, props: IndexCreatorConstructProps) {
    super(scope, id);

    // Create Lambda execution role
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant OpenSearch permissions
    props.openSearchConstruct.grantFullAccess(executionRole);

    // Create Lambda function for index creation
    const indexCreatorFunction = new lambda.Function(this, 'IndexCreator', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/create-index', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install --no-cache -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      role: executionRole,
      timeout: Duration.minutes(5),
      environment: {
        COLLECTION_ENDPOINT: props.openSearchConstruct.collectionEndpoint,
        INDEX_NAME: props.indexName,
        VECTOR_FIELD_NAME: props.vectorFieldName,
        VECTOR_DIMENSION: (props.vectorDimension || 1536).toString(),
      },
    });

    // Create Custom Resource provider
    const provider = new cr.Provider(this, 'IndexCreatorProvider', {
      onEventHandler: indexCreatorFunction,
    });

    // Create Custom Resource
    const resource = new CustomResource(this, 'IndexCreatorResource', {
      serviceToken: provider.serviceToken,
      properties: {
        indexName: props.indexName,
        vectorFieldName: props.vectorFieldName,
        vectorDimension: props.vectorDimension || 1536,
      },
    });

    this.indexName = props.indexName;
  }
}