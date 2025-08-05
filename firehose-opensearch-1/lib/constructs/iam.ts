import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface IAMConstructProps {
  readonly openSearchDomainArn: string;
  readonly firehoseDeliveryStreamArn: string;
  readonly backupBucketArn: string;
}

export class IAMConstruct extends Construct {
  public readonly dataProducerRole: iam.Role;
  public readonly dataConsumerRole: iam.Role;
  public readonly openSearchAdminRole: iam.Role;

  constructor(scope: Construct, id: string, props: IAMConstructProps) {
    super(scope, id);

    // Create role for data producers (applications that send data to Firehose)
    this.dataProducerRole = new iam.Role(this, 'DataProducerRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('ec2.amazonaws.com'),
        new iam.AccountPrincipal(this.node.tryGetContext('account') || '123456789012')
      ),
      description: 'Role for applications that produce data to Kinesis Firehose',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant permissions to put records to Firehose
    this.dataProducerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'firehose:PutRecord',
          'firehose:PutRecordBatch',
          'firehose:DescribeDeliveryStream',
        ],
        resources: [props.firehoseDeliveryStreamArn],
      })
    );

    // Create role for data consumers (applications that read from OpenSearch)
    this.dataConsumerRole = new iam.Role(this, 'DataConsumerRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('ec2.amazonaws.com'),
        new iam.AccountPrincipal(this.node.tryGetContext('account') || '123456789012')
      ),
      description: 'Role for applications that consume data from OpenSearch',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant read permissions to OpenSearch
    this.dataConsumerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'es:ESHttpGet',
          'es:ESHttpHead',
          'es:ESHttpPost', // For search queries
          'es:DescribeDomain',
          'es:DescribeDomains',
          'es:DescribeDomainConfig',
        ],
        resources: [
          props.openSearchDomainArn,
          `${props.openSearchDomainArn}/*`,
        ],
      })
    );

    // Create admin role for OpenSearch management
    this.openSearchAdminRole = new iam.Role(this, 'OpenSearchAdminRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.AccountPrincipal(this.node.tryGetContext('account') || '123456789012')
      ),
      description: 'Administrative role for OpenSearch domain management',
    });

    // Grant full permissions to OpenSearch for admin role
    this.openSearchAdminRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['es:*'],
        resources: [
          props.openSearchDomainArn,
          `${props.openSearchDomainArn}/*`,
        ],
      })
    );

    // Grant permissions to access backup bucket
    this.dataConsumerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:GetObjectVersion',
          's3:ListBucket',
        ],
        resources: [
          props.backupBucketArn,
          `${props.backupBucketArn}/*`,
        ],
      })
    );

    // Create managed policy for common CloudWatch permissions
    const cloudWatchPolicy = new iam.ManagedPolicy(this, 'CloudWatchPolicy', {
      description: 'Common CloudWatch permissions for monitoring',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogGroups',
            'logs:DescribeLogStreams',
            'cloudwatch:PutMetricData',
            'cloudwatch:GetMetricStatistics',
            'cloudwatch:ListMetrics',
          ],
          resources: ['*'],
        }),
      ],
    });

    // Attach CloudWatch policy to all roles
    this.dataProducerRole.addManagedPolicy(cloudWatchPolicy);
    this.dataConsumerRole.addManagedPolicy(cloudWatchPolicy);
    this.openSearchAdminRole.addManagedPolicy(cloudWatchPolicy);
  }

  /**
   * Create a custom role for specific use cases
   */
  public createCustomRole(
    id: string,
    assumedBy: iam.IPrincipal,
    description: string,
    policies?: iam.PolicyStatement[]
  ): iam.Role {
    const role = new iam.Role(this, id, {
      assumedBy,
      description,
    });

    if (policies) {
      policies.forEach(policy => {
        role.addToPolicy(policy);
      });
    }

    return role;
  }

  /**
   * Create a policy for cross-account access
   */
  public createCrossAccountPolicy(accountIds: string[]): iam.PolicyStatement {
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: accountIds.map(accountId => new iam.AccountPrincipal(accountId)),
      actions: [
        'firehose:PutRecord',
        'firehose:PutRecordBatch',
        'es:ESHttpGet',
        'es:ESHttpPost',
      ],
    });
  }
}