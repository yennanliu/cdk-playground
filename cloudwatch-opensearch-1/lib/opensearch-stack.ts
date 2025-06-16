import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as iam from "aws-cdk-lib/aws-iam";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib";

export interface OpensearchStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  logGroup: logs.LogGroup;
}

export class OpensearchStack extends cdk.Stack {
  public readonly domain: opensearch.Domain;
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

    // Create OpenSearch domain
    this.domain = new opensearch.Domain(this, "LogsDomain", {
      version: opensearch.EngineVersion.OPENSEARCH_2_3,
      removalPolicy: RemovalPolicy.DESTROY,
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: "m5.large.search",
      },
      ebs: {
        volumeSize: 10,
      },
      zoneAwareness: {
        enabled: false,
      },
      vpc: props.vpc,
      vpcSubnets: [
        {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      securityGroups: [opensearchSG],
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
      },
      // Secure access policy - only allow specific actions from VPC CIDR
      accessPolicies: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.AnyPrincipal()],
          actions: [
            "es:ESHttpGet",
            "es:ESHttpPost",
            "es:ESHttpPut",
            "es:ESHttpDelete",
            "es:ESHttpHead",
          ],
          resources: [
            `arn:aws:es:${this.region}:${this.account}:domain/logs-domain/*`,
          ],
          conditions: {
            IpAddress: {
              "aws:SourceIp": [props.vpc.vpcCidrBlock],
            },
          },
        }),
      ],
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

    // Create subscription filter to send logs to Firehose
    new logs.CfnSubscriptionFilter(this, "LogsSubscriptionFilter", {
      logGroupName: props.logGroup.logGroupName,
      filterPattern: "",
      destinationArn: this.deliveryStream.attrArn,
      roleArn: logsRole.roleArn,
    });

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

    // Add tags
    cdk.Tags.of(this).add("Project", "LogPipeline");
  }
}
