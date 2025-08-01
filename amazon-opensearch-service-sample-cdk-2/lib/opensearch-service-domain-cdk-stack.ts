// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Construct} from "constructs";
import {EbsDeviceVolumeType, ISecurityGroup, IVpc, SubnetSelection} from "aws-cdk-lib/aws-ec2";
import {CfnDomain, Domain, EngineVersion, TLSSecurityPolicy, ZoneAwarenessConfig} from "aws-cdk-lib/aws-opensearchservice";
import {CfnDeletionPolicy, RemovalPolicy, Stack, StackProps, CfnOutput} from "aws-cdk-lib";
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
  readonly accessPolicies?: PolicyStatement[],
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

    // Add OpenSearch permissions to the Firehose role
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'es:*',
        'opensearch:*'
      ],
      resources: [
        `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
        `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
      ]
    }));

    // Create base access policies array if not provided
    const accessPolicies = props.accessPolicies || [];

    // Add policy to allow any AWS principal to access the domain
    const openAccessPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new ArnPrincipal("*")],
      actions: [
        'es:*',
        'opensearch:*'
      ],
      resources: [
        `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
        `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
      ]
    });
    accessPolicies.push(openAccessPolicy);

    // Map objects from props
    const zoneAwarenessConfig: ZoneAwarenessConfig|undefined = props.availabilityZoneCount ?
        {enabled: true, availabilityZoneCount: props.availabilityZoneCount} : undefined;

    // Create new domain with security disabled
    const domain = new Domain(this, 'Domain', {
      version: props.version,
      domainName: props.domainName,
      accessPolicies: accessPolicies,
      enforceHttps: false,
      nodeToNodeEncryption: false,
      encryptionAtRest: {
        enabled: false
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
    cfnDomain.addPropertyOverride('AdvancedSecurityOptions', {
      Enabled: false,
      InternalUserDatabaseEnabled: false,
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