import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Duration } from 'aws-cdk-lib';

export interface BedrockEmbeddingsConstructProps {
  readonly modelId?: string;
  readonly maxTokens?: number;
  readonly region?: string;
}

export class BedrockEmbeddingsConstruct extends Construct {
  public readonly embedFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: BedrockEmbeddingsConstructProps = {}) {
    super(scope, id);

    // Create Lambda execution role
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add Bedrock permissions
    executionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:${props.region || 'us-east-1'}::foundation-model/${props.modelId || 'amazon.titan-embed-text-v1'}`,
      ],
    }));

    // Create Lambda function for text embeddings
    this.embedFunction = new lambda.Function(this, 'EmbeddingsFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/bedrock-embeddings', {
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
      memorySize: 1024,
      environment: {
        MODEL_ID: props.modelId || 'amazon.titan-embed-text-v1',
        MAX_TOKENS: (props.maxTokens || 8192).toString(),
        REGION: props.region || 'us-east-1',
      },
    });
  }
}