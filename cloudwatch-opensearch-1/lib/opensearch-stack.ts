import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface OpensearchStackProps extends cdk.StackProps {
    vpc: ec2.IVpc;
}

export class OpensearchStack extends cdk.Stack {
    public readonly domain: opensearch.Domain;
    public readonly firehoseRole: iam.Role;

    constructor(scope: Construct, id: string, props: OpensearchStackProps) {
        super(scope, id, props);

        // Create security group for OpenSearch
        const opensearchSG = new ec2.SecurityGroup(this, 'OpenSearchSG', {
            vpc: props.vpc,
            description: 'Security group for OpenSearch domain',
            allowAllOutbound: true,
        });
        opensearchSG.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Allow HTTPS access from anywhere'
        );

        // Create OpenSearch domain
        this.domain = new opensearch.Domain(this, 'LogsDomain', {
            version: opensearch.EngineVersion.OPENSEARCH_1_3,
            removalPolicy: RemovalPolicy.DESTROY,
            capacity: {
                dataNodes: 1,
                dataNodeInstanceType: 'm6g.large.search', // Using m6g.large for better compatibility
            },
            ebs: {
                volumeSize: 10,
            },
            // zoneAwareness: {
            //     enabled: false,
            //     availabilityZoneCount: 2
            // },
            zoneAwareness: { enabled: false },
            enforceHttps: true,
            nodeToNodeEncryption: true,
            encryptionAtRest: {
                enabled: true,
            },
            // For development/testing purposes only
            accessPolicies: [
                new iam.PolicyStatement({
                    actions: ['es:*'],
                    resources: ['*'],
                    principals: [new iam.AnyPrincipal()],
                }),
            ],
        });

        // Create IAM role for Firehose
        this.firehoseRole = new iam.Role(this, 'FirehoseRole', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
        });

        // Add permissions to Firehose role
        this.firehoseRole.addToPolicy(
            new iam.PolicyStatement({
                resources: [this.domain.domainArn, `${this.domain.domainArn}/*`],
                actions: [
                    'es:DescribeElasticsearchDomain',
                    'es:DescribeElasticsearchDomains',
                    'es:DescribeElasticsearchDomainConfig',
                    'es:ESHttpPost',
                    'es:ESHttpPut',
                ],
            })
        );

        // Create S3 bucket for Firehose backup
        const backupBucket = new s3.Bucket(this, 'FirehoseBackupBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development/testing only
            autoDeleteObjects: true, // For development/testing only
        });

        // Add S3 permissions to Firehose role
        this.firehoseRole.addToPolicy(
            new iam.PolicyStatement({
                resources: [backupBucket.bucketArn, `${backupBucket.bucketArn}/*`],
                actions: [
                    's3:AbortMultipartUpload',
                    's3:GetBucketLocation',
                    's3:GetObject',
                    's3:ListBucket',
                    's3:ListBucketMultipartUploads',
                    's3:PutObject',
                ],
            })
        );

        // Create Firehose delivery stream
        const firehoseDeliveryStream = new firehose.CfnDeliveryStream(this, 'LogsDeliveryStream', {
            deliveryStreamType: 'DirectPut',
            elasticsearchDestinationConfiguration: {
                domainArn: this.domain.domainArn,
                indexName: 'logs',
                roleArn: this.firehoseRole.roleArn,
                s3BackupMode: 'FailedDocumentsOnly',
                s3Configuration: {
                    bucketArn: backupBucket.bucketArn,
                    roleArn: this.firehoseRole.roleArn,
                    bufferingHints: {
                        intervalInSeconds: 60,
                        sizeInMBs: 1,
                    },
                },
            },
        });

        // Add tags
        cdk.Tags.of(this).add('Project', 'LogPipeline');
    }
}
