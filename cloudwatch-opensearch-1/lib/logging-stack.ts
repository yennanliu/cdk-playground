import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import { Construct } from 'constructs';

export class LoggingStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC with 3 AZs for OpenSearch compatibility
    this.vpc = new ec2.Vpc(this, 'LoggingVPC', {
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Create IAM role for EC2
    const ec2Role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // Add CloudWatch Agent policy
    ec2Role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );

    // Create security group for EC2
    const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for EC2 instance',
      allowAllOutbound: true,
    });

    // Allow SSH access (for development/testing only)
    ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access from anywhere'
    );

    // Create CloudWatch Log Group
    this.logGroup = new logs.LogGroup(this, 'SystemLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create EC2 instance
    const instance = new ec2.Instance(this, 'LoggingInstance', {
      vpc: this.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      securityGroup: ec2SecurityGroup,
      role: ec2Role,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Add user data to install and configure CloudWatch agent
    instance.addUserData(`
      yum update -y
      yum install -y amazon-cloudwatch-agent
      cat <<EOF > /opt/aws/amazon-cloudwatch-agent/bin/config.json
      {
        "logs": {
          "logs_collected": {
            "files": {
              "collect_list": [
                {
                  "file_path": "/var/log/messages",
                  "log_group_name": "${this.logGroup.logGroupName}",
                  "log_stream_name": "{instance_id}",
                  "timezone": "UTC"
                }
              ]
            }
          }
        }
      }
EOF
      /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/bin/config.json
      systemctl start amazon-cloudwatch-agent
      systemctl enable amazon-cloudwatch-agent
    `);

    // Add tags
    cdk.Tags.of(this).add('Project', 'LogPipeline');
  }

  // Method to add subscription filter after Firehose is created
  public addSubscriptionFilter(firehoseArn: string, firehoseRole: iam.Role) {
    // Create IAM role for CloudWatch Logs to put records into Firehose
    const logsRole = new iam.Role(this, 'LogsRole', {
      assumedBy: new iam.ServicePrincipal('logs.amazonaws.com'),
    });

    logsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'firehose:PutRecord',
          'firehose:PutRecordBatch',
        ],
        resources: [firehoseArn],
      })
    );

    // Create subscription filter to send logs to Firehose
    new logs.CfnSubscriptionFilter(this, 'LogsSubscriptionFilter', {
      logGroupName: this.logGroup.logGroupName,
      filterPattern: '',
      destinationArn: firehoseArn,
      roleArn: logsRole.roleArn,
    });
  }
}
