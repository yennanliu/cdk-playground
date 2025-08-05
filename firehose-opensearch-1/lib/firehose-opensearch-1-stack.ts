import { Duration, Stack, StackProps, CfnOutput, RemovalPolicy, Fn, CfnDeletionPolicy, CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export interface FirehoseOpensearch1StackProps extends StackProps {
  readonly domainName?: string;
  readonly deliveryStreamName?: string;
  readonly indexName?: string;
  readonly enableVpc?: boolean;
  readonly removalPolicy?: RemovalPolicy;
}

export class FirehoseOpensearch1Stack extends Stack {
  public readonly domain: opensearch.Domain;
  public readonly firehoseRole: iam.Role;
  public readonly cloudwatchLogsRole: iam.Role;
  public readonly deliveryStream: firehose.CfnDeliveryStream;
  public readonly backupBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: FirehoseOpensearch1StackProps = {}) {
    super(scope, id, props);

    // Extract configuration from props or use defaults
    const domainName = props.domainName || 'firehose-opensearch-domain';
    const deliveryStreamName = props.deliveryStreamName || 'firehose-opensearch-stream';
    const indexName = props.indexName || 'logs';
    const enableVpc = props.enableVpc ?? false;
    const removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

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

    // Create CloudWatch Logs destination role for sending logs to Firehose
    this.cloudwatchLogsRole = new iam.Role(this, 'CloudWatchLogsRole', {
      assumedBy: new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`),
      description: 'Role for CloudWatch Logs to send data to Firehose',
      roleName: `${this.stackName}-CloudWatchLogsRole`,
    });

    // Add Firehose permissions to CloudWatch Logs role
    this.cloudwatchLogsRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'firehose:PutRecord',
        'firehose:PutRecordBatch'
      ],
      resources: [
        `arn:aws:firehose:${this.region}:${this.account}:deliverystream/*`
      ]
    }));

    // Create domain with security enabled
    this.domain = new opensearch.Domain(this, 'Domain', {
      version: opensearch.EngineVersion.OPENSEARCH_1_3,
      domainName: domainName,
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true
      },
      capacity: {
        dataNodeInstanceType: 't3.small.search',
        dataNodes: 1,
      },
      ebs: {
        enabled: true,
        volumeSize: 20,
        volumeType: opensearch.EbsDeviceVolumeType.GP3
      },
      removalPolicy: removalPolicy
    });

    // Get the underlying CfnDomain to customize its behavior
    const cfnDomain = this.domain.node.defaultChild as opensearch.CfnDomain;
    
    // Enable advanced security options (FGAC) with master user and map IAM role
    cfnDomain.addPropertyOverride('AdvancedSecurityOptions', {
      Enabled: true,
      InternalUserDatabaseEnabled: true,
      MasterUserOptions: {
        MasterUserName: 'admin',
        MasterUserPassword: 'Admin@OpenSearch123!'
      }
    });

    // Add security configuration
    cfnDomain.addPropertyOverride('AdvancedOptions', {
      'rest.action.multi.allow_explicit_index': 'true'
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
          Resource: `arn:aws:es:${this.region}:${this.account}:domain/${domainName}/*`
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
          Resource: `arn:aws:es:${this.region}:${this.account}:domain/${domainName}/*`
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
          Resource: `arn:aws:es:${this.region}:${this.account}:domain/${domainName}/*`
        }
      ]
    });
    
    cfnDomain.cfnOptions.updateReplacePolicy = CfnDeletionPolicy.DELETE;
    cfnDomain.cfnOptions.deletionPolicy = CfnDeletionPolicy.DELETE;

    // Create S3 bucket for Firehose backup
    this.backupBucket = new s3.Bucket(this, `FirehoseBackupBucket`, {
      removalPolicy: removalPolicy,
      autoDeleteObjects: true,
    });

    // Grant the role permissions to write to this bucket
    this.backupBucket.grantReadWrite(this.firehoseRole);

    // Create Lambda function for processing data
    const processorLambda = new lambda.Function(this, `LogProcessor`, {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/firehose-processor'),
      timeout: Duration.minutes(5),
      memorySize: 512,
      description: 'Processes and formats data for OpenSearch'
    });

    // Grant Firehose permission to invoke the Lambda function
    processorLambda.grantInvoke(this.firehoseRole);

    // Create Kinesis Firehose
    this.deliveryStream = new firehose.CfnDeliveryStream(this, `OpenSearchDeliveryStream`, {
      deliveryStreamName: deliveryStreamName,
      deliveryStreamType: 'DirectPut',
      amazonopensearchserviceDestinationConfiguration: {
        indexName: indexName,
        domainArn: this.domain.domainArn,
        roleArn: this.firehoseRole.roleArn,
        indexRotationPeriod: 'NoRotation',
        bufferingHints: {
          intervalInSeconds: 60,
          sizeInMBs: 5
        },
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: `/aws/kinesisfirehose/${this.stackName}-${indexName}`,
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
          bucketArn: this.backupBucket.bucketArn,
          roleArn: this.firehoseRole.roleArn,
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 1
          },
          compressionFormat: 'UNCOMPRESSED'
        },
        retryOptions: {
          durationInSeconds: 300
        }
      }
    });

    // Create CloudWatch Logs for Firehose operations
    const logGroup = new LogGroup(this, `FirehoseLogGroup`, {
      logGroupName: `/aws/firehose/${this.stackName}-${indexName}`,
      removalPolicy: removalPolicy,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Lambda function for OpenSearch role mapping
    const roleMappingLambda = new lambda.Function(this, 'OpenSearchRoleMappingLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'opensearch-role-mapper.lambda_handler',
      code: lambda.Code.fromAsset('lambda/opensearch-role-mapper'),
      timeout: Duration.minutes(10),
      description: 'Configures OpenSearch role mapping for Firehose integration',
      environment: {
        LOG_LEVEL: 'INFO'
      }
    });

    // Grant the Lambda permission to be invoked by CloudFormation custom resources
    roleMappingLambda.addPermission('AllowCustomResourceInvoke', {
      principal: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
      action: 'lambda:InvokeFunction'
    });

    // Create AwsCustomResource to invoke the Lambda
    const roleMappingResource = new AwsCustomResource(this, 'OpenSearchRoleMapping', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        physicalResourceId: PhysicalResourceId.of('opensearch-role-mapping'),
        parameters: {
          FunctionName: roleMappingLambda.functionName,
          Payload: JSON.stringify({
            RequestType: 'Create',
            domainEndpoint: this.domain.domainEndpoint,
            firehoseRoleArn: this.firehoseRole.roleArn,
            masterUser: 'admin',
            masterPassword: 'Admin@OpenSearch123!',
            ResponseURL: 'dummy',
            StackId: 'dummy',
            RequestId: 'dummy',
            LogicalResourceId: 'OpenSearchRoleMapping'
          })
        }
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        physicalResourceId: PhysicalResourceId.of('opensearch-role-mapping'),
        parameters: {
          FunctionName: roleMappingLambda.functionName,
          Payload: JSON.stringify({
            RequestType: 'Update',
            domainEndpoint: this.domain.domainEndpoint,
            firehoseRoleArn: this.firehoseRole.roleArn,
            masterUser: 'admin',
            masterPassword: 'Admin@OpenSearch123!',
            ResponseURL: 'dummy',
            StackId: 'dummy',
            RequestId: 'dummy',
            LogicalResourceId: 'OpenSearchRoleMapping'
          })
        }
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [roleMappingLambda.functionArn]
        })
      ])
    });

    // Ensure the custom resource runs after the domain is created
    roleMappingResource.node.addDependency(this.domain);

    // Create CloudFormation outputs
    this.createOutputs();
  }

  private createOutputs(): void {
    // OpenSearch outputs
    new CfnOutput(this, 'OpenSearchDomainEndpoint', {
      value: this.domain.domainEndpoint,
      description: 'OpenSearch domain endpoint',
      exportName: `${Stack.of(this).stackName}-opensearch-endpoint`,
    });

    new CfnOutput(this, 'OpenSearchDomainArn', {
      value: this.domain.domainArn,
      description: 'OpenSearch domain ARN',
      exportName: `${Stack.of(this).stackName}-opensearch-arn`,
    });

    // Firehose outputs
    new CfnOutput(this, 'FirehoseDeliveryStreamName', {
      value: this.deliveryStream.deliveryStreamName || '',
      description: 'Kinesis Firehose delivery stream name',
      exportName: `${Stack.of(this).stackName}-firehose-name`,
    });

    new CfnOutput(this, 'FirehoseDeliveryStreamArn', {
      value: this.deliveryStream.attrArn,
      description: 'Kinesis Firehose delivery stream ARN',
      exportName: `${Stack.of(this).stackName}-firehose-arn`,
    });

    // S3 backup bucket output
    new CfnOutput(this, 'BackupBucketName', {
      value: this.backupBucket.bucketName,
      description: 'S3 backup bucket name',
      exportName: `${Stack.of(this).stackName}-backup-bucket`,
    });

    // IAM roles outputs
    new CfnOutput(this, 'FirehoseRoleArn', {
      value: this.firehoseRole.roleArn,
      description: 'Firehose role ARN',
      exportName: `${Stack.of(this).stackName}-firehose-role-arn`,
    });

    new CfnOutput(this, 'CloudWatchLogsRoleArn', {
      value: this.cloudwatchLogsRole.roleArn,
      description: 'CloudWatch Logs role ARN',
      exportName: `${Stack.of(this).stackName}-cloudwatch-logs-role-arn`,
    });
  }

  /**
   * Get OpenSearch domain endpoint URL with protocol
   */
  public getOpenSearchUrl(): string {
    return `https://${this.domain.domainEndpoint}`;
  }

  /**
   * Get Kibana URL for OpenSearch Dashboards
   */
  public getKibanaUrl(): string {
    return `${this.getOpenSearchUrl()}/_dashboards/`;
  }
}
