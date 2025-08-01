// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Construct} from "constructs";
import {EbsDeviceVolumeType, ISecurityGroup, IVpc, SubnetSelection} from "aws-cdk-lib/aws-ec2";
import {CfnDomain, Domain, EngineVersion, ZoneAwarenessConfig} from "aws-cdk-lib/aws-opensearchservice";
import {CfnDeletionPolicy, RemovalPolicy, Stack, CfnOutput} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import {PolicyStatement, Effect} from "aws-cdk-lib/aws-iam";
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

    // Add comprehensive OpenSearch permissions to the Firehose role
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'es:*',
        'opensearch:*'
      ],
      resources: [
        `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
        `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
        `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}`,
        `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
      ]
    }));

    // Map objects from props
    const zoneAwarenessConfig: ZoneAwarenessConfig|undefined = props.availabilityZoneCount ?
        {enabled: true, availabilityZoneCount: props.availabilityZoneCount} : undefined;

    // Create domain with security disabled
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
    
    // Enable advanced security options (FGAC) with master user
    cfnDomain.addPropertyOverride('AdvancedSecurityOptions', {
      Enabled: true,
      InternalUserDatabaseEnabled: true,
      MasterUserOptions: {
        MasterUserName: 'admin',
        MasterUserPassword: 'Admin@OpenSearch123!' // You should change this password
      }
    });

    // Add comprehensive access policy for Firehose, account access, and public access
    cfnDomain.addPropertyOverride('AccessPolicies', {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowPublicAccess',
          Effect: 'Allow',
          Principal: {
            AWS: '*'
          },
          Action: [
            'es:ESHttp*',
            'opensearch:ESHttp*'
          ],
          Resource: [
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
            `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
          ]
        },
        {
          Sid: 'AllowAccountRootAccess',
          Effect: 'Allow',
          Principal: {
            AWS: `arn:aws:iam::${this.account}:root`
          },
          Action: [
            'es:*',
            'opensearch:*'
          ],
          Resource: [
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
            `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}`,
            `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
          ]
        },
        {
          Sid: 'AllowFirehoseRoleAccess',
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
            'es:ESHttpBulk',
            'opensearch:ESHttpPost',
            'opensearch:ESHttpPut',
            'opensearch:ESHttpGet',
            'opensearch:ESHttpHead',
            'opensearch:ESHttpDelete',
            'opensearch:ESHttpBulk'
          ],
          Resource: [
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
            `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}`,
            `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
          ]
        },
        {
          Sid: 'AllowFirehoseServiceAccess',
          Effect: 'Allow',
          Principal: {
            Service: 'firehose.amazonaws.com'
          },
          Action: [
            'es:ESHttpPost',
            'es:ESHttpPut',
            'es:ESHttpBulk',
            'opensearch:ESHttpPost',
            'opensearch:ESHttpPut',
            'opensearch:ESHttpBulk'
          ],
          Resource: [
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
            `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
            `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}`,
            `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
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