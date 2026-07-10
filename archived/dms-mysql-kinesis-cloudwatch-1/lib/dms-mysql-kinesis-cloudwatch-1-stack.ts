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

    // Generate a unique identifier for this stack instance
    const stackId = id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const uniqueSuffix = cdk.Names.uniqueId(this).substring(0, 8);
    const namePrefix = `dms-${stackId}-${uniqueSuffix}`;

    // Create required DMS roles
    const dmsVpcRole = new iam.Role(this, "DmsVpcRole", {
      roleName: `${namePrefix}-vpc-role`,
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
          name: 'Public',  // Keep this simple to avoid token resolution issues
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private', // Keep this simple to avoid token resolution issues
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Create Kinesis Data Stream with unique name
    const streamName = `${namePrefix}-stream`;
    const kinesisStream = new kinesis.Stream(this, "CdcKinesisStream", {
      streamName: streamName,
      shardCount: 1,
      retentionPeriod: cdk.Duration.hours(24),
      streamMode: kinesis.StreamMode.PROVISIONED,
    });

    // Create CloudWatch Log Group with unique name
    const logGroupName = `/aws/dms/${namePrefix}`;
    const dmsLogGroup = new logs.LogGroup(this, "DmsLogGroup", {
      logGroupName: logGroupName,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create IAM role for DMS to access Kinesis
    const dmsKinesisRole = new iam.Role(this, "DmsKinesisRole", {
      roleName: `${namePrefix}-kinesis-role`,
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

    // Create security groups with unique names
    const rdsSecurityGroup = new ec2.SecurityGroup(this, "RdsSecurityGroup", {
      vpc,
      description: "Security group for RDS instance",
      allowAllOutbound: true,
    });

    const dmsSecurityGroup = new ec2.SecurityGroup(this, "DmsSecurityGroup", {
      vpc,
      description: "Security group for DMS replication instance",
      allowAllOutbound: true,
    });

    // Allow necessary ingress rules
    rdsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3306),
      "Allow MySQL access from anywhere"
    );

    rdsSecurityGroup.addIngressRule(
      dmsSecurityGroup,
      ec2.Port.tcp(3306),
      "Allow DMS to connect to RDS"
    );

    // Create DMS subnet group
    const dmsSubnetGroup = new dms.CfnReplicationSubnetGroup(
      this,
      "DmsSubnetGroup",
      {
        replicationSubnetGroupDescription: `${namePrefix} subnet group`,
        replicationSubnetGroupIdentifier: `${namePrefix}-subnet-group`,
        subnetIds: vpc.privateSubnets.map((subnet) => subnet.subnetId),
      }
    );

    // Create RDS instance with unique identifier
    const rdsInstance = new rds.DatabaseInstance(this, "MySQLInstance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      instanceIdentifier: `${namePrefix}-mysql`,
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
          binlog_format: "ROW",
          default_authentication_plugin: "mysql_native_password",
        },
      }),
    });

    // Create DMS replication instance
    const replicationInstance = new dms.CfnReplicationInstance(
      this,
      "DmsReplicationInstance",
      {
        replicationInstanceIdentifier: `${namePrefix}-rep-instance`,
        replicationInstanceClass: "dms.t3.micro",
        allocatedStorage: 20,
        publiclyAccessible: false,
        replicationSubnetGroupIdentifier: dmsSubnetGroup.ref,
        vpcSecurityGroupIds: [dmsSecurityGroup.securityGroupId],
      }
    );

    // Create DMS source endpoint
    const sourceEndpoint = new dms.CfnEndpoint(this, "SourceEndpoint", {
      endpointIdentifier: `${namePrefix}-source`,
      endpointType: "source",
      engineName: "mysql",
      mySqlSettings: {
        secretsManagerSecretId: rdsInstance.secret?.secretName,
        secretsManagerAccessRoleArn: dmsVpcRole.roleArn,
        afterConnectScript: "SELECT 1;",
      },
      extraConnectionAttributes: "initstmt=SET FOREIGN_KEY_CHECKS=0;parallelLoadThreads=1",
    });

    // Create DMS target endpoint
    const targetEndpoint = new dms.CfnEndpoint(this, "TargetEndpoint", {
      endpointIdentifier: `${namePrefix}-target`,
      endpointType: "target",
      engineName: "kinesis",
      kinesisSettings: {
        streamArn: kinesisStream.streamArn,
        messageFormat: "json",
        serviceAccessRoleArn: dmsKinesisRole.roleArn,
        includeTransactionDetails: true,
        includePartitionValue: true,
        partitionIncludeSchemaTable: true,
      },
    });

    // Create DMS replication task
    new dms.CfnReplicationTask(this, "DmsReplicationTask", {
      replicationTaskIdentifier: `${namePrefix}-task`,
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
              "schema-name": "mydb",
              "table-name": "%",
            },
            "rule-action": "include",
            "filters": []
          },
        ],
      }),
      replicationTaskSettings: JSON.stringify({
        Logging: {
          EnableLogging: true,
          LogComponents: [
            {
              Id: "SOURCE_UNLOAD",
              Severity: "LOGGER_SEVERITY_DEFAULT",
            },
            {
              Id: "SOURCE_CAPTURE",
              Severity: "LOGGER_SEVERITY_DEFAULT",
            },
            {
              Id: "TARGET_LOAD",
              Severity: "LOGGER_SEVERITY_DEFAULT",
            },
            {
              Id: "TARGET_APPLY",
              Severity: "LOGGER_SEVERITY_DEFAULT",
            },
          ],
        },
        ErrorBehavior: {
          DataErrorPolicy: "LOG_ERROR",
          DataTruncationErrorPolicy: "LOG_ERROR",
          DataErrorEscalationPolicy: "SUSPEND_TABLE",
          DataErrorEscalationCount: 0,
          TableErrorPolicy: "SUSPEND_TABLE",
          TableErrorEscalationPolicy: "STOP_TASK",
          TableErrorEscalationCount: 0,
          RecoverableErrorCount: -1,
          RecoverableErrorInterval: 5,
          RecoverableErrorThrottling: true,
          RecoverableErrorThrottlingMax: 1800,
          ApplyErrorDeletePolicy: "IGNORE_RECORD",
          ApplyErrorInsertPolicy: "LOG_ERROR",
          ApplyErrorUpdatePolicy: "LOG_ERROR",
          ApplyErrorEscalationPolicy: "LOG_ERROR",
          ApplyErrorEscalationCount: 0,
          FullLoadIgnoreConflicts: true
        },
      }),
    });

    // Add CloudWatch alarm
    new cloudwatch.Alarm(this, "DmsReplicationLagAlarm", {
      alarmName: `${namePrefix}-replication-lag`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/DMS",
        metricName: "CDCLatencySource",
        dimensionsMap: {
          ReplicationInstanceIdentifier: replicationInstance.ref,
        },
        period: cdk.Duration.minutes(1),
        statistic: "Average",
      }),
      threshold: 300,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: "DMS replication lag is too high",
    });

    // Add tags
    cdk.Tags.of(this).add('Project', namePrefix);

    // Stack outputs
    new cdk.CfnOutput(this, "RdsEndpoint", {
      value: rdsInstance.instanceEndpoint.hostname,
      description: `${namePrefix} RDS instance endpoint`,
    });

    new cdk.CfnOutput(this, "KinesisStreamName", {
      value: kinesisStream.streamName,
      description: `${namePrefix} Kinesis stream name`,
    });

    new cdk.CfnOutput(this, "RdsSecretName", {
      value: rdsInstance.secret?.secretName || "No secret created",
      description: `${namePrefix} RDS credentials secret name`,
    });

    new cdk.CfnOutput(this, "CloudWatchLogGroup", {
      value: dmsLogGroup.logGroupName,
      description: `${namePrefix} CloudWatch Log Group`,
    });
  }
}
