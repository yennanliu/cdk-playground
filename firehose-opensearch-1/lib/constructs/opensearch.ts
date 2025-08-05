import { Construct } from 'constructs';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Stack, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';

export interface OpenSearchConstructProps {
  readonly domainName: string;
  readonly description?: string;
  readonly engineVersion?: opensearch.EngineVersion;
  readonly capacity?: opensearch.CapacityConfig;
  readonly ebs?: opensearch.EbsOptions;
  readonly removalPolicy?: RemovalPolicy;
  readonly vpc?: ec2.IVpc;
  readonly zoneAwareness?: opensearch.ZoneAwarenessConfig;
  readonly logging?: boolean;
  readonly fineGrainedAccess?: boolean;
  readonly nodeToNodeEncryption?: boolean;
  readonly encryptionAtRest?: boolean;
  readonly enforceHttps?: boolean;
  readonly kmsKey?: kms.IKey;
}

export class OpenSearchConstruct extends Construct {
  public readonly domain: opensearch.Domain;
  public readonly domainEndpoint: string;
  public readonly domainArn: string;

  constructor(scope: Construct, id: string, props: OpenSearchConstructProps) {
    super(scope, id);

    // Create KMS key if not provided
    const key = props.kmsKey || new kms.Key(this, 'OpenSearchKMSKey', {
      alias: `${props.domainName}-opensearch`,
      enableKeyRotation: true,
      removalPolicy: props.removalPolicy || RemovalPolicy.DESTROY,
    });

    // Create the OpenSearch domain with minimal T3-compatible configuration
    this.domain = new opensearch.Domain(this, 'Domain', {
      domainName: props.domainName.toLowerCase(),
      version: opensearch.EngineVersion.OPENSEARCH_1_3, // Use stable version
      
      // Single node capacity configuration - use M6G for Multi-AZ support
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: 'm6g.small.search',
      },

      // EBS configuration
      ebs: {
        volumeSize: 20,
        volumeType: ec2.EbsDeviceVolumeType.GP2,
      },

      // Basic security - minimal for T3
      nodeToNodeEncryption: false, // Disabled for single node
      encryptionAtRest: {
        enabled: false, // Simplified for T3
      },
      enforceHttps: true,

      // Zone awareness explicitly disabled
      zoneAwareness: {
        enabled: false,
      },

      // No VPC for public access simplicity
      vpc: undefined,

      // No logging for minimal setup
      logging: undefined,

      // Removal policy
      removalPolicy: props.removalPolicy || RemovalPolicy.DESTROY,
    });

    // Store important properties
    this.domainEndpoint = this.domain.domainEndpoint;
    this.domainArn = this.domain.domainArn;

    // Add CloudFormation outputs
    new CfnOutput(this, 'DomainEndpoint', {
      value: this.domainEndpoint,
      description: 'OpenSearch domain endpoint',
      exportName: `${props.domainName}-endpoint`,
    });

    new CfnOutput(this, 'DomainArn', {
      value: this.domainArn,
      description: 'OpenSearch domain ARN',
      exportName: `${props.domainName}-arn`,
    });
  }

  /**
   * Grant read access to the OpenSearch domain
   */
  public grantRead(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'es:ESHttpGet',
        'es:ESHttpPost',
        'opensearch:*'
      ],
      resourceArns: [this.domainArn, `${this.domainArn}/*`],
    });
  }

  /**
   * Grant write access to the OpenSearch domain
   */
  public grantWrite(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpDelete',
        'opensearch:*'
      ],
      resourceArns: [this.domainArn, `${this.domainArn}/*`],
    });
  }

  /**
   * Grant full access to the OpenSearch domain
   */
  public grantFullAccess(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'es:*',
        'opensearch:*'
      ],
      resourceArns: [this.domainArn, `${this.domainArn}/*`],
    });
  }
}