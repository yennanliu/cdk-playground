// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Construct} from "constructs";
import {EbsDeviceVolumeType, ISecurityGroup, IVpc, SubnetSelection} from "aws-cdk-lib/aws-ec2";
import {CfnDomain, Domain, EngineVersion, ZoneAwarenessConfig} from "aws-cdk-lib/aws-opensearchservice";
import {CfnDeletionPolicy, RemovalPolicy, Stack, CfnOutput, CustomResource, Duration} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import {PolicyStatement, Effect} from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
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
      description: 'Role for Firehose to access OpenSearch and S3',
      roleName: `${this.stackName}-FirehoseRole`, // <-- assign a specific role name here
    });

    // Add full OpenSearch permissions
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'es:*',
        'opensearch:*'
      ],
      resources: [
        `arn:aws:es:${this.region}:*:domain/*`,
        `arn:aws:opensearch:${this.region}:*:domain/*`
      ]
    }));

    // Add S3 permissions for any Firehose backup bucket
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        's3:AbortMultipartUpload',
        's3:GetBucketLocation',
        's3:GetObject',
        's3:ListBucket',
        's3:ListBucketMultipartUploads',
        's3:PutObject',
        's3:PutObjectAcl'
      ],
      resources: [
        'arn:aws:s3:::firehose-*',
        'arn:aws:s3:::firehose-*/*'
      ]
    }));

    // Add CloudWatch Logs permissions
    this.firehoseRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:PutLogEvents',
        'logs:CreateLogStream',
        'logs:CreateLogGroup'
      ],
      resources: [
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/kinesisfirehose/*`,
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/kinesisfirehose/*:log-stream:*`
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
    
    // Enable advanced security options (FGAC) with master user and map IAM role
    cfnDomain.addPropertyOverride('AdvancedSecurityOptions', {
      Enabled: true,
      InternalUserDatabaseEnabled: true,
      MasterUserOptions: {
        MasterUserName: 'admin',
        MasterUserPassword: 'Admin@OpenSearch123!' // You should change this password
      }
    });

    // Note: Role mappings cannot be configured via CloudFormation
    // They must be configured after domain creation via OpenSearch API
    // The access policy below provides the necessary permissions for Firehose

    // Add security configuration for the all_access role
    cfnDomain.addPropertyOverride('AdvancedOptions', {
      'rest.action.multi.allow_explicit_index': 'true'
    });

    // Master user options are handled in AdvancedSecurityOptions

    // Security groups are handled by the Domain construct
    // Add comprehensive access policy for Firehose role and service
    cfnDomain.addPropertyOverride('AccessPolicies', {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowFirehoseRoleAccess',
          Effect: 'Allow',
          Principal: {
            AWS: this.firehoseRole.roleArn
          },
          Action: [
            'es:*',
            'opensearch:*'
          ],
          Resource: [
            `arn:aws:es:${this.region}:*:domain/*`,
            `arn:aws:opensearch:${this.region}:*:domain/*`
          ]
        },
        {
          Sid: 'AllowFirehoseServiceAccess',
          Effect: 'Allow',
          Principal: {
            Service: 'firehose.amazonaws.com'
          },
          Action: [
            'es:*',
            'opensearch:*'
          ],
          Resource: [
            `arn:aws:es:${this.region}:*:domain/*`,
            `arn:aws:opensearch:${this.region}:*:domain/*`
          ]
        }
      ]
    });
    
    cfnDomain.cfnOptions.updateReplacePolicy = CfnDeletionPolicy.DELETE;
    cfnDomain.cfnOptions.deletionPolicy = CfnDeletionPolicy.DELETE;

    this.domainEndpoint = domain.domainEndpoint;
    this.domain = domain;

    // Export the Firehose role ARN and name for use by other stacks
    new CfnOutput(this, 'FirehoseRoleArn', {
      value: this.firehoseRole.roleArn,
      exportName: `${this.stackName}-FirehoseRoleArn`,
      description: 'ARN of the Firehose role for OpenSearch access'
    });

    // Create Lambda function to configure OpenSearch role mappings
    const roleMappingLambda = new lambda.Function(this, 'RoleMappingLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      code: lambda.Code.fromInline(`
import json
import boto3
import requests
from requests.auth import HTTPBasicAuth
import cfnresponse

def handler(event, context):
    try:
        domain_endpoint = event['ResourceProperties']['DomainEndpoint']
        master_username = event['ResourceProperties']['MasterUsername']
        master_password = event['ResourceProperties']['MasterPassword']
        firehose_role_arn = event['ResourceProperties']['FirehoseRoleArn']
        
        if event['RequestType'] == 'Create' or event['RequestType'] == 'Update':
            # Configure role mapping for all_access role
            url = f"https://{domain_endpoint}/_plugins/_security/api/rolesmapping/all_access"
            
            role_mapping = {
                "backend_roles": [firehose_role_arn],
                "hosts": [],
                "users": [],
                "reserved": False
            }
            
            response = requests.put(
                url,
                json=role_mapping,
                auth=HTTPBasicAuth(master_username, master_password),
                headers={'Content-Type': 'application/json'},
                verify=True,
                timeout=30
            )
            
            if response.status_code in [200, 201]:
                print(f"Role mapping configured successfully: {response.text}")
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {"Message": "Role mapping configured"})
            else:
                print(f"Failed to configure role mapping: {response.status_code} - {response.text}")
                cfnresponse.send(event, context, cfnresponse.FAILED, {"Message": f"Failed: {response.text}"})
        
        elif event['RequestType'] == 'Delete':
            # On delete, we don't need to remove the role mapping as the domain will be deleted
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {"Message": "Delete completed"})
            
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Message": str(e)})
`),
      environment: {
        'PYTHONPATH': '/var/runtime'
      }
    });

    // Add permissions for Lambda to access OpenSearch
    roleMappingLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpGet'
      ],
      resources: [domain.domainArn + '/*']
    }));

    // Create custom resource to trigger role mapping configuration
    const roleMappingResource = new CustomResource(this, 'RoleMappingResource', {
      serviceToken: roleMappingLambda.functionArn,
      properties: {
        DomainEndpoint: domain.domainEndpoint,
        MasterUsername: 'admin',
        MasterPassword: 'Admin@OpenSearch123!',
        FirehoseRoleArn: this.firehoseRole.roleArn,
        // Add a timestamp to force update when needed
        Timestamp: Date.now().toString()
      }
    });

    // Ensure the custom resource runs after the domain is ready
    roleMappingResource.node.addDependency(domain);

    new CfnOutput(this, 'FirehoseRoleName', {
      value: this.firehoseRole.roleName,
      exportName: `${this.stackName}-FirehoseRoleName`,
      description: 'Name of the Firehose role for OpenSearch access'
    });

    new CfnOutput(this, 'RoleMappingStatus', {
      value: roleMappingResource.getAttString('Message'),
      description: 'Status of role mapping configuration'
    });
  }
}