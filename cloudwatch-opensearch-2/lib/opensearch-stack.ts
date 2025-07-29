import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as iam from "aws-cdk-lib/aws-iam";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib";

export interface OpensearchStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class OpensearchStack extends cdk.Stack {
  public readonly domain: opensearch.IDomain;
  public readonly firehoseRole: iam.Role;
  public readonly deliveryStream: firehose.CfnDeliveryStream;

  constructor(scope: Construct, id: string, props: OpensearchStackProps) {
    super(scope, id, props);

    // Create security group for OpenSearch
    const opensearchSG = new ec2.SecurityGroup(this, "OpenSearchSG", {
      vpc: props.vpc,
      description: "Security group for OpenSearch domain",
      allowAllOutbound: true,
    });

    // Only allow HTTPS access from within the VPC
    opensearchSG.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      "Allow HTTPS access from VPC"
    );

    // Create OpenSearch domain using CfnDomain for precise control
    const cfnDomain = new opensearch.CfnDomain(this, "LogsDomain", {
      engineVersion: "OpenSearch_2.3",
      clusterConfig: {
        instanceType: "t3.small.search",
        instanceCount: 1,
        dedicatedMasterEnabled: false,
        zoneAwarenessEnabled: false, // Explicitly disable zone awareness
      },
      ebsOptions: {
        ebsEnabled: true,
        volumeSize: 10,
        volumeType: "gp3",
      },
      domainEndpointOptions: {
        enforceHttps: true,
      },
      nodeToNodeEncryptionOptions: {
        enabled: true,
      },
      encryptionAtRestOptions: {
        enabled: true,
      },
      accessPolicies: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: "es:*",
            Resource: `arn:aws:es:${this.region}:${this.account}:domain/logs-domain/*`,
          },
        ],
      },
    });

    // Create Domain wrapper for compatibility
    this.domain = opensearch.Domain.fromDomainAttributes(this, "LogsDomainRef", {
      domainArn: cfnDomain.attrArn,
      domainEndpoint: cfnDomain.attrDomainEndpoint,
    });

    // Create IAM role for Firehose
    this.firehoseRole = new iam.Role(this, "FirehoseRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    });

    // Add permissions to Firehose role for OpenSearch
    this.firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [this.domain.domainArn, `${this.domain.domainArn}/*`],
        actions: [
          "es:DescribeDomain",
          "es:DescribeDomains",
          "es:DescribeDomainConfig",
          "es:ESHttpPost",
          "es:ESHttpPut",
        ],
      })
    );

    // Create S3 bucket for Firehose backup
    const backupBucket = new s3.Bucket(this, "FirehoseBackupBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Add S3 permissions to Firehose role
    this.firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [backupBucket.bucketArn, `${backupBucket.bucketArn}/*`],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
        ],
      })
    );

    // Create Firehose delivery stream with simplified configuration
    this.deliveryStream = new firehose.CfnDeliveryStream(
      this,
      "LogsDeliveryStream",
      {
        deliveryStreamType: "DirectPut",
        deliveryStreamName: "opensearch-logs-stream",
        amazonopensearchserviceDestinationConfiguration: {
          domainArn: this.domain.domainArn,
          indexName: "logs",
          roleArn: this.firehoseRole.roleArn,
          s3BackupMode: "AllDocuments",
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 1,
          },
          s3Configuration: {
            bucketArn: backupBucket.bucketArn,
            roleArn: this.firehoseRole.roleArn,
            bufferingHints: {
              intervalInSeconds: 60,
              sizeInMBs: 1,
            },
            compressionFormat: "GZIP",
          },
        },
      }
    );

    // Create IAM role for CloudWatch Logs to put records into Firehose
    const logsRole = new iam.Role(this, "LogsRole", {
      assumedBy: new iam.ServicePrincipal("logs.amazonaws.com"),
    });

    logsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["firehose:PutRecord", "firehose:PutRecordBatch"],
        resources: [this.deliveryStream.attrArn],
      })
    );

    // Create Lambda function to discover and manage log group subscriptions
    const logGroupDiscoveryFunction = new lambda.Function(this, "LogGroupDiscovery", {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: "index.handler",
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(`
import boto3
import json
import cfnresponse

def handler(event, context):
    try:
        logs_client = boto3.client('logs')
        
        # Get request properties
        request_type = event['RequestType']
        firehose_arn = event['ResourceProperties']['FirehoseArn']
        logs_role_arn = event['ResourceProperties']['LogsRoleArn']
        
        if request_type == 'Create' or request_type == 'Update':
            # Get all log groups
            paginator = logs_client.get_paginator('describe_log_groups')
            log_groups = []
            
            for page in paginator.paginate():
                log_groups.extend(page['logGroups'])
            
            # Create subscription filters for all log groups
            created_filters = []
            for log_group in log_groups:
                log_group_name = log_group['logGroupName']
                filter_name = f"opensearch-subscription-{log_group_name.replace('/', '-').replace('_', '-')}"
                
                try:
                    # Check if subscription filter already exists
                    existing_filters = logs_client.describe_subscription_filters(
                        logGroupName=log_group_name
                    )
                    
                    # Remove existing filters to avoid conflicts
                    for existing_filter in existing_filters['subscriptionFilters']:
                        logs_client.delete_subscription_filter(
                            logGroupName=log_group_name,
                            filterName=existing_filter['filterName']
                        )
                    
                    # Create new subscription filter
                    logs_client.put_subscription_filter(
                        logGroupName=log_group_name,
                        filterName=filter_name,
                        filterPattern='',
                        destinationArn=firehose_arn,
                        roleArn=logs_role_arn
                    )
                    created_filters.append(log_group_name)
                    print(f"Created subscription filter for {log_group_name}")
                except Exception as e:
                    print(f"Failed to create subscription filter for {log_group_name}: {e}")
                    continue
            
            response_data = {
                'LogGroupsProcessed': len(log_groups),
                'FiltersCreated': len(created_filters),
                'LogGroups': [lg['logGroupName'] for lg in log_groups]
            }
            
        elif request_type == 'Delete':
            # Clean up - remove all subscription filters we created
            paginator = logs_client.get_paginator('describe_log_groups')
            
            for page in paginator.paginate():
                for log_group in page['logGroups']:
                    log_group_name = log_group['logGroupName']
                    try:
                        existing_filters = logs_client.describe_subscription_filters(
                            logGroupName=log_group_name
                        )
                        
                        for existing_filter in existing_filters['subscriptionFilters']:
                            if existing_filter['filterName'].startswith('opensearch-subscription-'):
                                logs_client.delete_subscription_filter(
                                    logGroupName=log_group_name,
                                    filterName=existing_filter['filterName']
                                )
                                print(f"Deleted subscription filter for {log_group_name}")
                    except Exception as e:
                        print(f"Failed to delete subscription filter for {log_group_name}: {e}")
                        continue
            
            response_data = {'Status': 'Cleanup completed'}
        
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data)
        
    except Exception as e:
        print(f"Error: {e}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {'Error': str(e)})
      `),
    });

    // Add permissions to the Lambda function
    logGroupDiscoveryFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:DescribeLogGroups",
          "logs:DescribeSubscriptionFilters",
          "logs:PutSubscriptionFilter",
          "logs:DeleteSubscriptionFilter",
        ],
        resources: ["*"],
      })
    );

    // Add permission to pass the logs role
    logGroupDiscoveryFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [logsRole.roleArn],
      })
    );

    // Create custom resource to trigger the log group discovery
    const logGroupDiscoveryProvider = new cr.Provider(this, "LogGroupDiscoveryProvider", {
      onEventHandler: logGroupDiscoveryFunction,
    });

    const logGroupDiscoveryResource = new cdk.CustomResource(this, "LogGroupDiscoveryResource", {
      serviceToken: logGroupDiscoveryProvider.serviceToken,
      properties: {
        FirehoseArn: this.deliveryStream.attrArn,
        LogsRoleArn: logsRole.roleArn,
        // Add a timestamp to force updates when stack is updated
        Timestamp: Date.now().toString(),
      },
    });

    // Ensure the custom resource runs after the delivery stream is created
    logGroupDiscoveryResource.node.addDependency(this.deliveryStream);
    logGroupDiscoveryResource.node.addDependency(logsRole);

    // Output domain endpoint
    new cdk.CfnOutput(this, "OpenSearchDomainEndpoint", {
      value: `https://${this.domain.domainEndpoint}`,
      description: "OpenSearch Domain Endpoint",
    });

    // Output Firehose delivery stream ARN
    new cdk.CfnOutput(this, "FirehoseDeliveryStreamArn", {
      value: this.deliveryStream.attrArn,
      description: "Firehose Delivery Stream ARN",
    });

    // Output number of log groups processed
    new cdk.CfnOutput(this, "LogGroupsProcessed", {
      value: logGroupDiscoveryResource.getAtt("LogGroupsProcessed").toString(),
      description: "Number of CloudWatch Log Groups Processed",
    });

    // Add tags
    cdk.Tags.of(this).add("Project", "LogPipeline");
  }
}
