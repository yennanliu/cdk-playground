import { Construct } from 'constructs';
import * as opensearch from 'aws-cdk-lib/aws-opensearch';
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

    // Create the OpenSearch domain
    this.domain = new opensearch.Domain(this, 'Domain', {
      domainName: props.domainName.toLowerCase(),
      version: props.engineVersion || opensearch.EngineVersion.OPENSEARCH_2_5,
      
      // Capacity configuration
      capacity: props.capacity || {
        dataNodes: 1,
        dataNodeInstanceType: 't3.small.search',
      },

      // EBS configuration
      ebs: props.ebs || {
        volumeSize: 20,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },

      // Security configuration
      nodeToNodeEncryption: props.nodeToNodeEncryption !== false,
      encryptionAtRest: {
        enabled: props.encryptionAtRest !== false,
        kmsKey: key,
      },
      enforceHttps: props.enforceHttps !== false,
      tlsSecurityPolicy: opensearch.TlsSecurityPolicy.TLS_1_2,

      // Fine-grained access control
      fineGrainedAccessControl: props.fineGrainedAccess !== false ? {
        masterUserName: 'admin',
      } : undefined,

      // Zone awareness for multi-AZ deployment
      zoneAwareness: props.zoneAwareness || {
        enabled: false,
      },

      // VPC configuration
      vpc: props.vpc,
      vpcSubnets: props.vpc ? [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }] : undefined,

      // Logging
      logging: props.logging !== false ? {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true,
      } : undefined,

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
   * Grant read access to the OpenSearch collection
   */
  public grantRead(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'aoss:ReadDocument',
        'aoss:DescribeIndex',
      ],
      resourceArns: [this.collectionArn, `${this.collectionArn}/*`],
    });
  }

  /**
   * Grant write access to the OpenSearch collection
   */
  public grantWrite(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'aoss:WriteDocument',
        'aoss:CreateIndex',
        'aoss:UpdateIndex',
      ],
      resourceArns: [this.collectionArn, `${this.collectionArn}/*`],
    });
  }

  /**
   * Grant full access to the OpenSearch collection
   */
  public grantFullAccess(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['aoss:*'],
      resourceArns: [this.collectionArn, `${this.collectionArn}/*`],
    });
  }
}