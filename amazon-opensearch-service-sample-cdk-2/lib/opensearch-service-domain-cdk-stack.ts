// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Construct} from "constructs";
import {EbsDeviceVolumeType, ISecurityGroup, IVpc, SubnetSelection} from "aws-cdk-lib/aws-ec2";
import {CfnDomain, Domain, EngineVersion, ZoneAwarenessConfig} from "aws-cdk-lib/aws-opensearchservice";
import {CfnDeletionPolicy, RemovalPolicy, Stack, CfnOutput} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import {PolicyStatement, Effect, ArnPrincipal} from "aws-cdk-lib/aws-iam";
import {StackPropsExt} from "./stack-composer";

export interface opensearchServiceDomainCdkProps extends StackPropsExt {
  readonly version: EngineVersion,
  readonly domainName: string,
  readonly dataNodeInstanceType?: string,
  readonly dataNodes?: number,
  readonly dedicatedManagerNodeType?: string,
  readonly dedicatedManagerNodeCount?: number,
  readonly warmInstanceType?: string,
  readonly warmNodes?: number
  readonly ebsEnabled?: boolean,
  readonly ebsIops?: number,
  readonly ebsVolumeSize?: number,
  readonly ebsVolumeType?: EbsDeviceVolumeType,
  readonly vpc?: IVpc,
  readonly vpcSubnets?: SubnetSelection[],
  readonly vpcSecurityGroups?: ISecurityGroup[],
  readonly availabilityZoneCount?: number
}

export class OpensearchServiceDomainCdkStack extends Stack {
  public readonly domainEndpoint: string;
  public readonly domain: Domain;
  public readonly firehoseRole: iam.Role;

  constructor(scope: Construct, id: string, props: opensearchServiceDomainCdkProps) {
    super(scope, id, props);

    // Create Firehose role with all necessary permissions
    this.firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });

    // Add comprehensive OpenSearch permissions for FGAC-enabled domain with full write access
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        // Core HTTP operations
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpGet', 
        'es:ESHttpHead',
        'es:ESHttpDelete',
        'es:ESHttpPatch',
        
        // Domain operations
        'es:ESDescribeDomain',
        'es:DescribeDomain',
        'es:DescribeDomainConfig',
        'es:ESGetConfiguration',
        'es:ESListDomainNames',
        
        // Index operations
        'es:CreateIndex',
        'es:DeleteIndex',
        'es:UpdateIndex',
        'es:ListIndices',
        'es:DescribeIndex',
        
        // Document operations (including bulk)
        'es:IndexDocument',
        'es:UpdateDocument',
        'es:DeleteDocument',
        'es:BulkRequest',
        
        // Search and query operations
        'es:Search',
        'es:Suggest',
        'es:GetSource',
        
        // Mapping operations
        'es:PutMapping',
        'es:GetMapping',
        'es:DeleteMapping',
        
        // Template operations
        'es:PutTemplate',
        'es:GetTemplate',
        'es:DeleteTemplate',
        
        // Cluster operations
        'es:ESCrossClusterGet',
        'es:ESCrossClusterSearch'
      ],
      resources: [
        `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
        `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
        `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}`,
        `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
      ]
    }));

    // Add IAM pass role permission for Firehose service
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'iam:PassRole'
      ],
      resources: [
        this.firehoseRole.roleArn
      ]
    }));

    // Add CloudWatch Logs permissions to the Firehose role
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams'
      ],
      resources: [
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/kinesisfirehose/*`,
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/firehose/*`
      ]
    }));

    // Add S3 permissions to the Firehose role (will be used by Firehose stack)
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        's3:AbortMultipartUpload',
        's3:GetBucketLocation',
        's3:GetObject',
        's3:ListBucket',
        's3:ListBucketMultipartUploads',
        's3:PutObject'
      ],
      resources: ['*'] // Will be restricted by the Firehose stack when bucket is created
    }));

    // Map objects from props
    const zoneAwarenessConfig: ZoneAwarenessConfig|undefined = props.availabilityZoneCount ?
        {enabled: true, availabilityZoneCount: props.availabilityZoneCount} : undefined;

    // Create domain with security settings required for FGAC
    const domain = new Domain(this, 'Domain', {
      version: props.version,
      domainName: props.domainName,
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true
      },
      capacity: {
        dataNodeInstanceType: props.dataNodeInstanceType,
        dataNodes: props.dataNodes,
        masterNodeInstanceType: props.dedicatedManagerNodeType,
        masterNodes: props.dedicatedManagerNodeCount,
        warmInstanceType: props.warmInstanceType,
        warmNodes: props.warmNodes
      },
      ebs: {
        enabled: props.ebsEnabled,
        iops: props.ebsIops,
        volumeSize: props.ebsVolumeSize,
        volumeType: props.ebsVolumeType
      },
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      securityGroups: props.vpcSecurityGroups,
      zoneAwareness: zoneAwarenessConfig,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Get the underlying CfnDomain to customize its behavior
    const cfnDomain = domain.node.defaultChild as CfnDomain;
    
    // Enable Fine-grained access control with both internal users and IAM role support
    cfnDomain.addPropertyOverride('AdvancedSecurityOptions', {
      Enabled: true,
      InternalUserDatabaseEnabled: true,
      MasterUserOptions: {
        MasterUserName: 'admin',
        MasterUserPassword: 'AdminPassword123!'
      },
      // Configure for IAM role access
      AnonymousAuthEnabled: false
    });

    // Access policy for FGAC with explicit Firehose role permissions
    cfnDomain.addPropertyOverride('AccessPolicies', {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            AWS: [
              `arn:aws:iam::${this.account}:root`,
              this.firehoseRole.roleArn
            ]
          },
          Action: 'es:*',
          Resource: [
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`
          ]
        },
        {
          Effect: 'Allow',
          Principal: {
            AWS: this.firehoseRole.roleArn
          },
          Action: [
            'es:ESHttpPost',
            'es:ESHttpPut',
            'es:ESHttpGet',
            'es:ESHttpHead',
            'es:ESHttpDelete',
            'es:ESHttpPatch',
            'es:BulkRequest',
            'es:IndexDocument',
            'es:UpdateDocument',
            'es:DeleteDocument',
            'es:Search',
            'es:CreateIndex',
            'es:PutMapping',
            'es:GetMapping'
          ],
          Resource: [
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`
          ]
        }
      ]
    });
    
    cfnDomain.cfnOptions.updateReplacePolicy = CfnDeletionPolicy.DELETE;
    cfnDomain.cfnOptions.deletionPolicy = CfnDeletionPolicy.DELETE;

    this.domainEndpoint = domain.domainEndpoint;
    this.domain = domain;

    // Export the Firehose role ARN for use by other stacks
    new CfnOutput(this, 'FirehoseRoleArn', {
      value: this.firehoseRole.roleArn,
      exportName: `${this.stackName}-FirehoseRoleArn`,
      description: 'ARN of the Firehose role for OpenSearch access'
    });
  }
}