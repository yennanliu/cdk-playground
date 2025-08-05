import { Construct } from 'constructs';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface OpenSearchConstructProps {
  readonly domainName: string;
  readonly vpc?: ec2.IVpc;
  readonly engineVersion?: opensearch.EngineVersion;
  readonly instanceType?: string;
  readonly instanceCount?: number;
  readonly volumeSize?: number;
  readonly removalPolicy?: RemovalPolicy;
}

export class OpenSearchConstruct extends Construct {
  public readonly domain: opensearch.Domain;
  public readonly domainEndpoint: string;
  public readonly domainArn: string;

  constructor(scope: Construct, id: string, props: OpenSearchConstructProps) {
    super(scope, id);

    // Create OpenSearch domain configuration
    const domainProps: opensearch.DomainProps = {
      domainName: props.domainName,
      version: props.engineVersion || opensearch.EngineVersion.OPENSEARCH_2_5,
      
      // Capacity configuration
      capacity: {
        dataNodes: props.instanceCount || 1,
        dataNodeInstanceType: props.instanceType || 't3.small.search',
      },

      // EBS configuration
      ebs: {
        volumeSize: props.volumeSize || 20,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },

      // Security configuration
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
      },
      enforceHttps: true,
      tlsSecurityPolicy: opensearch.TlsSecurityPolicy.TLS_1_2,

      // Fine-grained access control
      fineGrainedAccessControl: {
        masterUserName: 'admin',
      },

      // Zone awareness for multi-AZ deployment (if more than 1 instance)
      zoneAwareness: {
        enabled: (props.instanceCount || 1) > 1,
        availabilityZoneCount: (props.instanceCount || 1) > 1 ? 2 : undefined,
      },

      // Removal policy
      removalPolicy: props.removalPolicy || RemovalPolicy.DESTROY,

      // Logging
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true,
      },
    };

    // Add VPC configuration if provided
    if (props.vpc) {
      domainProps.vpc = props.vpc;
      domainProps.vpcSubnets = [
        {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ];
    }

    // Create the OpenSearch domain
    this.domain = new opensearch.Domain(this, 'Domain', domainProps);

    // Store important properties
    this.domainEndpoint = this.domain.domainEndpoint;
    this.domainArn = this.domain.domainArn;

    // Create access policy for Kinesis Firehose
    const firehoseAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [
        new iam.ServicePrincipal('firehose.amazonaws.com'),
      ],
      actions: [
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpGet',
      ],
      resources: [
        `${this.domain.domainArn}/*`,
      ],
    });

    this.domain.addAccessPolicies(firehoseAccessPolicy);
  }

  /**
   * Grant read access to the OpenSearch domain
   */
  public grantRead(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'es:ESHttpGet',
        'es:ESHttpHead',
        'es:DescribeDomain',
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
      ],
      resourceArns: [this.domainArn, `${this.domainArn}/*`],
    });
  }
}