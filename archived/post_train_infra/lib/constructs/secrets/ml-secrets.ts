import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy, SecretValue } from 'aws-cdk-lib';

export interface MlSecretsProps {
  resourcePrefix: string;
}

export class MlSecretsConstruct extends Construct {
  public readonly huggingfaceTokenSecret: secretsmanager.Secret;
  public readonly weaviateApiKeySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: MlSecretsProps) {
    super(scope, id);

    // HuggingFace API token for model downloads
    // This secret should be manually populated after deployment
    this.huggingfaceTokenSecret = new secretsmanager.Secret(this, 'HuggingFaceToken', {
      secretName: `${props.resourcePrefix}/huggingface-token`,
      description: 'HuggingFace API token for downloading models',
      removalPolicy: RemovalPolicy.DESTROY,
      secretObjectValue: {
        token: SecretValue.unsafePlainText('PLACEHOLDER_REPLACE_ME'),
      },
    });

    // Weaviate API key with auto-generated value
    this.weaviateApiKeySecret = new secretsmanager.Secret(this, 'WeaviateApiKey', {
      secretName: `${props.resourcePrefix}/weaviate-api-key`,
      description: 'Weaviate API key for vector database authentication',
      removalPolicy: RemovalPolicy.DESTROY,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ apiKey: '' }),
        generateStringKey: 'apiKey',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
  }
}
