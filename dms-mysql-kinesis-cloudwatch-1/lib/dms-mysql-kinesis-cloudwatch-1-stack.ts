import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dms from "aws-cdk-lib/aws-dms";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

export class DmsMysqlKinesisCloudwatch1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create required DMS roles
    const dmsVpcRole = new iam.Role(this, "DmsVpcRole", {
      roleName: "dms-vpc-role",
      assumedBy: new iam.ServicePrincipal("dms.amazonaws.com"),
    });

    dmsVpcRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonDMSVPCManagementRole"
      )
    );

    // Create VPC for our resources
    const vpc = new ec2.Vpc(this, "DmsVpc", {
      maxAzs: 2,
      natGateways: 1,
      ipAddresses: ec2.IpAddresses.cidr("172.16.0.0/16"),
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Create Kinesis Data Stream
    const kinesisStream = new kinesis.Stream(this, "CdcKinesisStream", {
      streamName: "mysql-cdc-stream",
      shardCount: 1,
      retentionPeriod: cdk.Duration.hours(24),
      streamMode: kinesis.StreamMode.PROVISIONED,
    });

    // Create CloudWatch Log Group for DMS
    const dmsLogGroup = new logs.LogGroup(this, "DmsLogGroup", {
      logGroupName: "/aws/dms/replication",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create IAM role for DMS to access Kinesis
    const dmsKinesisRole = new iam.Role(this, "DmsKinesisRole", {
      assumedBy: new iam.ServicePrincipal("dms.amazonaws.com"),
    });

    // Grant DMS permissions to write to Kinesis
    kinesisStream.grantWrite(dmsKinesisRole);

    // Add CloudWatch permissions to DMS role
    dmsKinesisRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "cloudwatch:PutMetricData",
        ],
        resources: ["*"],
      })
    );

    // Create security group for RDS
    const rdsSecurityGroup = new ec2.SecurityGroup(this, "RdsSecurityGroup", {
      vpc,
      description: "Security group for RDS instance",
      allowAllOutbound: true,
    });

    // Allow inbound MySQL traffic from anywhere (as per requirement 8)
    rdsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3306),
      "Allow MySQL access from anywhere"
    );

    const dmsSecurityGroup = new ec2.SecurityGroup(this, "DmsSecurityGroup", {
      vpc,
      description: "Security group for DMS replication instance",
      allowAllOutbound: true,
    });

    // Allow DMS to connect to RDS
    rdsSecurityGroup.addIngressRule(
      dmsSecurityGroup,
      ec2.Port.tcp(3306),
      "Allow DMS to connect to RDS"
    );

    // Allow DMS to connect to RDS from private subnets
    rdsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(3306),
      "Allow access from within VPC"
    );

    // Create RDS instance with binary logging enabled
    const rdsInstance = new rds.DatabaseInstance(this, "MySQLInstance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: 20,
      securityGroups: [rdsSecurityGroup],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      publiclyAccessible: true,
      parameterGroup: new rds.ParameterGroup(this, "MysqlParameterGroup", {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_0,
        }),
        parameters: {
          // Enable binary logging for CDC
          binlog_format: "ROW",
          // Use native password authentication
          default_authentication_plugin: "mysql_native_password",
        },
      }),
    });

    // Create DMS replication instance
    const dmsSubnetGroup = new dms.CfnReplicationSubnetGroup(
      this,
      "DmsSubnetGroup",
      {
        replicationSubnetGroupDescription: "DMS subnet group",
        subnetIds: vpc.privateSubnets.map((subnet) => subnet.subnetId),
      }
    );

    const replicationInstance = new dms.CfnReplicationInstance(
      this,
      "DmsReplicationInstance",
      {
        replicationInstanceClass: "dms.t3.micro",
        allocatedStorage: 20,
        publiclyAccessible: false,
        replicationSubnetGroupIdentifier: dmsSubnetGroup.ref,
        vpcSecurityGroupIds: [dmsSecurityGroup.securityGroupId],
      }
    );

    // Get RDS credentials
    const username =
      rdsInstance.secret?.secretValueFromJson("username").unsafeUnwrap() ||
      "admin";
    const password = rdsInstance.secret
      ?.secretValueFromJson("password")
      .unsafeUnwrap();

    // Create DMS source endpoint (MySQL)
    const sourceEndpoint = new dms.CfnEndpoint(this, "SourceEndpoint", {
      endpointType: "source",
      engineName: "mysql",
      serverName: rdsInstance.instanceEndpoint.hostname,
      port: 3306,
      databaseName: "mydb", // Default database name
      username,
      password,
    });

    // Create DMS target endpoint (Kinesis)
    const targetEndpoint = new dms.CfnEndpoint(this, "TargetEndpoint", {
      endpointType: "target",
      engineName: "kinesis",
      kinesisSettings: {
        streamArn: kinesisStream.streamArn,
        messageFormat: "json",
        serviceAccessRoleArn: dmsKinesisRole.roleArn,
      },
    });

    // Create DMS replication task with enhanced monitoring
    new dms.CfnReplicationTask(this, "DmsReplicationTask", {
      replicationInstanceArn: replicationInstance.ref,
      sourceEndpointArn: sourceEndpoint.ref,
      targetEndpointArn: targetEndpoint.ref,
      migrationType: "cdc",
      tableMappings: JSON.stringify({
        rules: [
          {
            "rule-type": "selection",
            "rule-id": "1",
            "rule-name": "1",
            "object-locator": {
              "schema-name": "%",
              "table-name": "%",
            },
            "rule-action": "include",
          },
        ],
      }),
      replicationTaskSettings: JSON.stringify({
        TargetMetadata: {
          TargetSchema: "",
          SupportLobs: true,
          FullLobMode: false,
          LobChunkSize: 64,
          LimitedSizeLobMode: true,
          LobMaxSize: 32,
        },
        Logging: {
          EnableLogging: true,
          LogComponents: [
            {
              Id: "TRANSFORMATION",
              Severity: "LOGGER_SEVERITY_DEFAULT",
            },
            {
              Id: "SOURCE_UNLOAD",
              Severity: "LOGGER_SEVERITY_DEFAULT",
            },
            {
              Id: "IO",
              Severity: "LOGGER_SEVERITY_DEFAULT",
            },
            {
              Id: "TARGET_LOAD",
              Severity: "LOGGER_SEVERITY_DEFAULT",
            },
          ],
        },
        CloudWatchLogGroup: dmsLogGroup.logGroupName,
        CloudWatchLogStream: "dms-replication-task",
      }),
    });

    // Create CloudWatch Alarms for monitoring
    new cloudwatch.Alarm(this, "DmsReplicationLagAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/DMS",
        metricName: "CDCLatencySource",
        dimensionsMap: {
          ReplicationInstanceIdentifier: replicationInstance.ref,
        },
        period: cdk.Duration.minutes(1),
        statistic: "Average",
      }),
      threshold: 300, // 5 minutes lag
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: "DMS replication lag is too high",
    });

    // Output important information
    new cdk.CfnOutput(this, "RdsEndpoint", {
      value: rdsInstance.instanceEndpoint.hostname,
      description: "RDS instance endpoint",
    });

    new cdk.CfnOutput(this, "KinesisStreamName", {
      value: kinesisStream.streamName,
      description: "Kinesis stream for CDC data",
    });

    new cdk.CfnOutput(this, "RdsSecretName", {
      value: rdsInstance.secret?.secretName || "No secret created",
      description: "Secret name for RDS credentials",
    });

    new cdk.CfnOutput(this, "CloudWatchLogGroup", {
      value: dmsLogGroup.logGroupName,
      description: "CloudWatch Log Group for DMS",
    });
  }
}
