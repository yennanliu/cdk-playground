import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import { CfnDomain, Domain, EngineVersion } from 'aws-cdk-lib/aws-opensearchservice';
import * as iam from 'aws-cdk-lib/aws-iam';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { EbsDeviceVolumeType } from 'aws-cdk-lib/aws-ec2';

export class OpensearchStack1Stack extends Stack {
  public readonly domainEndpoint: string;
  public readonly domain: Domain;
  public readonly firehoseRole: iam.Role;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create Firehose role with all necessary permissions
    this.firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      description: 'Role for Firehose to access OpenSearch and S3',
      roleName: `${this.stackName}-FirehoseRole`,
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

    // Add CloudWatch Logs permissions for Firehose operations
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

    // Create domain with security disabled (for simplicity)
    const domain = new Domain(this, 'Domain', {
      version: EngineVersion.OPENSEARCH_2_5,
      domainName: 'opensearch-stack-1-domain',
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true
      },
      capacity: {
        dataNodeInstanceType: 't3.small.search',
        dataNodes: 1,
        multiAzWithStandbyEnabled: false
      },
      ebs: {
        enabled: true,
        volumeSize: 10,
        volumeType: EbsDeviceVolumeType.GP3
      },
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

    // Add comprehensive access policy for Firehose role, service, and authenticated users
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
          Resource: `arn:aws:es:${this.region}:${this.account}:domain/opensearch-stack-1-domain/*`
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
          Resource: `arn:aws:es:${this.region}:${this.account}:domain/opensearch-stack-1-domain/*`
        },
        {
          Sid: 'AllowAllAccess',
          Effect: 'Allow',
          Principal: {
            AWS: '*'
          },
          Action: [
            'es:*',
            'opensearch:*'
          ],
          Resource: `arn:aws:es:${this.region}:${this.account}:domain/opensearch-stack-1-domain/*`
        }
      ]
    });

    this.domainEndpoint = domain.domainEndpoint;
    this.domain = domain;

    // Create S3 bucket for Firehose backup
    const backupBucket = new s3.Bucket(this, 'FirehoseBackupBucket', {
      bucketName: `opensearch-firehose-backup-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Grant the role permissions to write to this stack's S3 bucket
    backupBucket.grantReadWrite(this.firehoseRole);

    // Create Lambda function for processing CloudWatch Logs data
    const processorLambda = new lambda.Function(this, 'LogProcessor', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromInline(`
import base64
import json
import gzip

def lambda_handler(event, context):
    output = []
    
    for record in event['records']:
        # Decode the data
        payload = base64.b64decode(record['data'])
        
        # Process the log data (add timestamp, transform format, etc.)
        try:
            # Try to decompress if gzipped
            try:
                payload = gzip.decompress(payload)
            except:
                pass
                
            log_data = json.loads(payload.decode('utf-8'))
            
            # Add processing timestamp
            log_data['processed_at'] = context.aws_request_id
            
            # Re-encode
            processed_data = json.dumps(log_data)
            encoded_data = base64.b64encode(processed_data.encode('utf-8')).decode('utf-8')
            
            output.append({
                'recordId': record['recordId'],
                'result': 'Ok',
                'data': encoded_data
            })
        except Exception as e:
            # In case of error, pass through original data
            output.append({
                'recordId': record['recordId'],
                'result': 'ProcessingFailed',
                'data': record['data']
            })
    
    return {'records': output}
      `),
      timeout: Duration.minutes(5),
      memorySize: 512,
      description: 'Processes CloudWatch Logs data for Firehose'
    });

    // Grant Firehose permission to invoke the Lambda function
    processorLambda.grantInvoke(this.firehoseRole);

    // Create Kinesis Firehose delivery stream
    const deliveryStream = new firehose.CfnDeliveryStream(this, 'OpenSearchDeliveryStream', {
      deliveryStreamName: `${this.stackName}-logs-stream`,
      deliveryStreamType: 'DirectPut',
      amazonopensearchserviceDestinationConfiguration: {
        indexName: 'logs',
        domainArn: domain.domainArn,
        roleArn: this.firehoseRole.roleArn,
        indexRotationPeriod: 'NoRotation',
        bufferingHints: {
          intervalInSeconds: 60,
          sizeInMBs: 5
        },
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: `/aws/kinesisfirehose/${this.stackName}-logs`,
          logStreamName: `${this.stackName}-OpenSearchDelivery`
        },
        processingConfiguration: {
          enabled: true,
          processors: [
            {
              type: 'Lambda',
              parameters: [
                {
                  parameterName: 'LambdaArn',
                  parameterValue: processorLambda.functionArn
                }
              ]
            }
          ]
        },
        s3BackupMode: 'FailedDocumentsOnly',
        s3Configuration: {
          bucketArn: backupBucket.bucketArn,
          roleArn: this.firehoseRole.roleArn,
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 1
          }
        },
        retryOptions: {
          durationInSeconds: 300
        }
      }
    });

    // Create CloudWatch Log Group for Firehose operations
    const logGroup = new logs.LogGroup(this, 'FirehoseLogGroup', {
      logGroupName: `/aws/kinesisfirehose/${this.stackName}-logs`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Output important values
    new CfnOutput(this, 'OpenSearchDomainEndpoint', {
      value: domain.domainEndpoint,
      description: 'OpenSearch Domain Endpoint',
    });

    new CfnOutput(this, 'OpenSearchDashboardsURL', {
      value: `https://${domain.domainEndpoint}/_dashboards/`,
      description: 'OpenSearch Dashboards URL',
    });

    new CfnOutput(this, 'FirehoseDeliveryStreamName', {
      value: deliveryStream.deliveryStreamName || `${this.stackName}-logs-stream`,
      description: 'Kinesis Firehose Delivery Stream Name',
    });

    new CfnOutput(this, 'S3BackupBucketName', {
      value: backupBucket.bucketName,
      description: 'S3 Backup Bucket for Firehose',
    });

    new CfnOutput(this, 'FirehoseRoleArn', {
      value: this.firehoseRole.roleArn,
      description: 'ARN of the Firehose role for OpenSearch access'
    });
  }
}