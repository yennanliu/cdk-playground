import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkConstruct } from './constructs/network';
import { OpenSearchConstruct } from './constructs/opensearch';
import { FirehoseConstruct } from './constructs/firehose';
import { IAMConstruct } from './constructs/iam';
import { BedrockEmbeddingsConstruct } from './constructs/bedrock-embeddings';

export interface FirehoseOpensearch1StackProps extends StackProps {
  readonly domainName?: string;
  readonly deliveryStreamName?: string;
  readonly indexName?: string;
  readonly enableVpc?: boolean;
  readonly removalPolicy?: RemovalPolicy;
}

export class FirehoseOpensearch1Stack extends Stack {
  public readonly openSearchConstruct: OpenSearchConstruct;
  public readonly firehoseConstruct: FirehoseConstruct;
  public readonly networkConstruct?: NetworkConstruct;
  public readonly iamConstruct: IAMConstruct;

  constructor(scope: Construct, id: string, props: FirehoseOpensearch1StackProps = {}) {
    super(scope, id, props);

    // Extract configuration from props or use defaults
    const domainName = props.domainName || 'firehose-opensearch-domain';
    const deliveryStreamName = props.deliveryStreamName || 'firehose-opensearch-stream';
    const indexName = props.indexName || 'logs';
    const enableVpc = props.enableVpc ?? false;
    const removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // Create network construct if VPC is enabled
    if (enableVpc) {
      this.networkConstruct = new NetworkConstruct(this, 'Network', {
        vpcName: `${id}-vpc`,
        removalPolicy,
      });
    }

    // Create OpenSearch construct with proper configuration from reference project
    this.openSearchConstruct = new OpenSearchConstruct(this, 'OpenSearch', {
      domainName,
      vpc: this.networkConstruct?.vpc,
      fineGrainedAccess: true,
      removalPolicy,
    });

    // Create Bedrock embeddings function (but make it optional since we're using log processing)
    const bedrock = new BedrockEmbeddingsConstruct(this, 'Bedrock', {
      modelId: 'amazon.titan-embed-text-v1',
      maxTokens: 8192,
      region: Stack.of(this).region,
    });

    // Create Firehose construct
    this.firehoseConstruct = new FirehoseConstruct(this, 'Firehose', {
      deliveryStreamName,
      openSearchConstruct: this.openSearchConstruct,
      bedrockEmbeddings: bedrock,
      indexName,
      vectorFieldName: 'text_embedding',
      bufferInterval: Duration.seconds(60),
      bufferSize: 5,
      backupBucketPrefix: 'firehose-backup/',
      removalPolicy,
    });

    // Create IAM construct
    this.iamConstruct = new IAMConstruct(this, 'IAM', {
      openSearchDomainArn: this.openSearchConstruct.domainArn,
      firehoseDeliveryStreamArn: this.firehoseConstruct.deliveryStream.attrArn,
      backupBucketArn: this.firehoseConstruct.backupBucket.bucketArn,
    });

    // Create CloudFormation outputs
    this.createOutputs();
  }

  private createOutputs(): void {
    // OpenSearch outputs
    new CfnOutput(this, 'OpenSearchDomainEndpoint', {
      value: this.openSearchConstruct.domainEndpoint,
      description: 'OpenSearch domain endpoint',
      exportName: `${Stack.of(this).stackName}-opensearch-endpoint`,
    });

    new CfnOutput(this, 'OpenSearchDomainArn', {
      value: this.openSearchConstruct.domainArn,
      description: 'OpenSearch domain ARN',
      exportName: `${Stack.of(this).stackName}-opensearch-arn`,
    });

    // Firehose outputs
    new CfnOutput(this, 'FirehoseDeliveryStreamName', {
      value: this.firehoseConstruct.deliveryStream.deliveryStreamName || '',
      description: 'Kinesis Firehose delivery stream name',
      exportName: `${Stack.of(this).stackName}-firehose-name`,
    });

    new CfnOutput(this, 'FirehoseDeliveryStreamArn', {
      value: this.firehoseConstruct.deliveryStream.attrArn,
      description: 'Kinesis Firehose delivery stream ARN',
      exportName: `${Stack.of(this).stackName}-firehose-arn`,
    });

    // S3 backup bucket output
    new CfnOutput(this, 'BackupBucketName', {
      value: this.firehoseConstruct.backupBucket.bucketName,
      description: 'S3 backup bucket name',
      exportName: `${Stack.of(this).stackName}-backup-bucket`,
    });

    // IAM roles outputs
    new CfnOutput(this, 'DataProducerRoleArn', {
      value: this.iamConstruct.dataProducerRole.roleArn,
      description: 'Data producer role ARN',
      exportName: `${Stack.of(this).stackName}-producer-role-arn`,
    });

    new CfnOutput(this, 'DataConsumerRoleArn', {
      value: this.iamConstruct.dataConsumerRole.roleArn,
      description: 'Data consumer role ARN',
      exportName: `${Stack.of(this).stackName}-consumer-role-arn`,
    });

    // VPC outputs (if enabled)
    if (this.networkConstruct) {
      new CfnOutput(this, 'VpcId', {
        value: this.networkConstruct.vpc.vpcId,
        description: 'VPC ID',
        exportName: `${Stack.of(this).stackName}-vpc-id`,
      });

      new CfnOutput(this, 'PrivateSubnetIds', {
        value: this.networkConstruct.privateSubnets.map(subnet => subnet.subnetId).join(','),
        description: 'Private subnet IDs',
        exportName: `${Stack.of(this).stackName}-private-subnets`,
      });
    }
  }

  /**
   * Get OpenSearch domain endpoint URL with protocol
   */
  public getOpenSearchUrl(): string {
    return `https://${this.openSearchConstruct.domainEndpoint}`;
  }

  /**
   * Get Kibana URL for OpenSearch Dashboards
   */
  public getKibanaUrl(): string {
    return `${this.getOpenSearchUrl()}/_dashboards/`;
  }
}
