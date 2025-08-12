import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

export interface FirehoseRoleProps {
  readonly region: string;
  readonly account: string;
}

export class FirehoseRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: FirehoseRoleProps) {
    super(scope, id);

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      description: 'Role for Firehose to access OpenSearch and S3',
    });

    // Add comprehensive OpenSearch permissions
    this.role.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'es:*',
        'opensearch:*'
      ],
      resources: [
        `arn:aws:es:${props.region}:*:domain/*`,
        `arn:aws:opensearch:${props.region}:*:domain/*`
      ]
    }));

    // Add S3 permissions for Firehose backup operations
    this.role.addToPolicy(new PolicyStatement({
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
        'arn:aws:s3:::firehose-*/*',
        'arn:aws:s3:::kinesisfirehose*',
        'arn:aws:s3:::kinesisfirehose*/*'
      ]
    }));

    // Add CloudWatch Logs permissions for Firehose operations
    this.role.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: [
        `arn:aws:logs:${props.region}:${props.account}:log-group:/aws/kinesisfirehose/*`,
        `arn:aws:logs:${props.region}:${props.account}:log-group:/aws/kinesisfirehose/*:log-stream:*`
      ]
    }));

    // Add Lambda permissions for processing
    this.role.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'lambda:GetFunction',
        'lambda:InvokeFunction'
      ],
      resources: [
        `arn:aws:lambda:${props.region}:${props.account}:function:*`
      ]
    }));
  }
}

export interface CloudWatchLogsRoleProps {
  readonly region: string;
  readonly account: string;
}

export class CloudWatchLogsRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: CloudWatchLogsRoleProps) {
    super(scope, id);

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal(`logs.${props.region}.amazonaws.com`),
      description: 'Role for CloudWatch Logs to send data to Firehose',
    });

    // Add Firehose permissions
    this.role.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'firehose:PutRecord',
        'firehose:PutRecordBatch'
      ],
      resources: [
        `arn:aws:firehose:${props.region}:${props.account}:deliverystream/*`
      ]
    }));
  }
}

export interface LoggingRolesProps {
  readonly region: string;
  readonly account: string;
}

export class LoggingRoles extends Construct {
  public readonly firehoseRole: iam.Role;
  public readonly cloudWatchLogsRole: iam.Role;

  constructor(scope: Construct, id: string, props: LoggingRolesProps) {
    super(scope, id);

    const firehose = new FirehoseRole(this, 'Firehose', props);
    const cloudWatchLogs = new CloudWatchLogsRole(this, 'CloudWatchLogs', props);

    this.firehoseRole = firehose.role;
    this.cloudWatchLogsRole = cloudWatchLogs.role;
  }
}