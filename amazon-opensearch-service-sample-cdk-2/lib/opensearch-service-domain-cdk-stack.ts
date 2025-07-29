// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Construct} from "constructs";
import {EbsDeviceVolumeType, ISecurityGroup, IVpc, SubnetSelection} from "aws-cdk-lib/aws-ec2";
import {Domain, EngineVersion, TLSSecurityPolicy, ZoneAwarenessConfig} from "aws-cdk-lib/aws-opensearchservice";
import {RemovalPolicy, SecretValue, Stack, StackProps} from "aws-cdk-lib";
import {IKey, Key} from "aws-cdk-lib/aws-kms";
import * as iam from "aws-cdk-lib/aws-iam";
import {PolicyStatement, Effect, ArnPrincipal, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {ILogGroup, LogGroup} from "aws-cdk-lib/aws-logs";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
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
  readonly useUnsignedBasicAuth?: boolean,
  readonly fineGrainedManagerUserARN?: string,
  readonly fineGrainedManagerUserName?: string,
  readonly fineGrainedManagerUserSecretManagerKeyARN?: string,
  readonly enforceHTTPS?: boolean,
  readonly tlsSecurityPolicy?: TLSSecurityPolicy,
  readonly ebsEnabled?: boolean,
  readonly ebsIops?: number,
  readonly ebsVolumeSize?: number,
  readonly ebsVolumeType?: EbsDeviceVolumeType,
  readonly encryptionAtRestEnabled?: boolean,
  readonly encryptionAtRestKmsKeyARN?: string,
  readonly loggingAppLogEnabled?: boolean,
  readonly loggingAppLogGroupARN?: string,
  readonly loggingAuditLogEnabled?: boolean,
  readonly loggingAuditLogGroupARN?: string,
  readonly nodeToNodeEncryptionEnabled?: boolean,
  readonly vpc?: IVpc,
  readonly vpcSubnets?: SubnetSelection[],
  readonly vpcSecurityGroups?: ISecurityGroup[],
  readonly availabilityZoneCount?: number,
  readonly domainRemovalPolicy?: RemovalPolicy
}


export class OpensearchServiceDomainCdkStack extends Stack {
  public readonly domainEndpoint: string;
  public readonly domain: Domain;

  constructor(scope: Construct, id: string, props: opensearchServiceDomainCdkProps) {
    super(scope, id, props);

    // Create base access policies array if not provided
    const accessPolicies = props.accessPolicies || [];

    // Add policy to allow Firehose service to write to OpenSearch
    const firehosePolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new iam.ServicePrincipal('firehose.amazonaws.com')],
      actions: [
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpGet',
        'opensearch:ESHttpPost',
        'opensearch:ESHttpPut', 
        'opensearch:ESHttpGet'
      ],
      resources: [`arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`]
    });
    accessPolicies.push(firehosePolicy);

    // Only add policies if not using open access policy
    // The open access policy from context will override these anyway

    // The code that defines your stack goes here

    // Retrieve existing account resources if defined
    const earKmsKey: IKey|undefined = props.encryptionAtRestKmsKeyARN && props.encryptionAtRestEnabled ?
        Key.fromKeyArn(this, "earKey", props.encryptionAtRestKmsKeyARN) : undefined

    const managerUserSecret: SecretValue|undefined = props.fineGrainedManagerUserSecretManagerKeyARN ?
        Secret.fromSecretCompleteArn(this, "managerSecret", props.fineGrainedManagerUserSecretManagerKeyARN).secretValue : undefined

    const appLG: ILogGroup|undefined = props.loggingAppLogGroupARN && props.loggingAppLogEnabled ?
        LogGroup.fromLogGroupArn(this, "appLogGroup", props.loggingAppLogGroupARN) : undefined

    const auditLG: ILogGroup|undefined = props.loggingAuditLogGroupARN && props.loggingAuditLogEnabled ?
        LogGroup.fromLogGroupArn(this, "auditLogGroup", props.loggingAuditLogGroupARN) : undefined

    // Map objects from props
    const zoneAwarenessConfig: ZoneAwarenessConfig|undefined = props.availabilityZoneCount ?
        {enabled: true, availabilityZoneCount: props.availabilityZoneCount} : undefined

    const domain = new Domain(this, 'Domain', {
      version: props.version,
      domainName: props.domainName,
      accessPolicies: accessPolicies,
      useUnsignedBasicAuth: props.useUnsignedBasicAuth,
      capacity: {
        dataNodeInstanceType: props.dataNodeInstanceType,
        dataNodes: props.dataNodes,
        masterNodeInstanceType: props.dedicatedManagerNodeType,
        masterNodes: props.dedicatedManagerNodeCount,
        warmInstanceType: props.warmInstanceType,
        warmNodes: props.warmNodes
      },
      fineGrainedAccessControl: {
        masterUserArn: props.fineGrainedManagerUserARN,
        masterUserName: props.fineGrainedManagerUserName,
        masterUserPassword: managerUserSecret
      },
      nodeToNodeEncryption: props.nodeToNodeEncryptionEnabled,
      encryptionAtRest: {
        enabled: props.encryptionAtRestEnabled,
        kmsKey: earKmsKey
      },
      enforceHttps: props.enforceHTTPS,
      tlsSecurityPolicy: props.tlsSecurityPolicy,
      ebs: {
        enabled: props.ebsEnabled,
        iops: props.ebsIops,
        volumeSize: props.ebsVolumeSize,
        volumeType: props.ebsVolumeType
      },
      logging: {
        appLogEnabled: props.loggingAppLogEnabled,
        appLogGroup: appLG,
        auditLogEnabled: props.loggingAuditLogEnabled,
        auditLogGroup: auditLG
      },
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      securityGroups: props.vpcSecurityGroups,
      zoneAwareness: zoneAwarenessConfig,
      removalPolicy: props.domainRemovalPolicy
    });

    this.domainEndpoint = domain.domainEndpoint;
    this.domain = domain;
  }
}
