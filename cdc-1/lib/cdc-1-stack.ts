import { Duration, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as dms from 'aws-cdk-lib/aws-dms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class Cdc1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC for our CDC system
    const vpc = new ec2.Vpc(this, 'CdcVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'Database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }
      ]
    });

    // Security groups
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for RDS MySQL databases',
      allowAllOutbound: false
    });

    const dmsSecurityGroup = new ec2.SecurityGroup(this, 'DmsSecurityGroup', {
      vpc,
      description: 'Security group for DMS replication instance',
      allowAllOutbound: true
    });

    // Allow DMS to connect to databases
    dbSecurityGroup.addIngressRule(
      dmsSecurityGroup,
      ec2.Port.tcp(3306),
      'Allow DMS access to MySQL'
    );

    // DB subnet group
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      vpc,
      description: 'Subnet group for CDC databases',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      }
    });

    // Source Database (DB1)
    const sourceDatabase = new rds.DatabaseInstance(this, 'SourceDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      subnetGroup: dbSubnetGroup,
      securityGroups: [dbSecurityGroup],
      databaseName: 'sourcedb',
      credentials: rds.Credentials.fromGeneratedSecret('cdcuser', {
        secretName: 'cdc/source-db-credentials'
      }),
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      parameterGroup: new rds.ParameterGroup(this, 'SourceDbParameterGroup', {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_0
        }),
        parameters: {
          'binlog_format': 'ROW',
          'log_bin': '1',
          'binlog_checksum': 'NONE',
          'binlog_row_image': 'FULL'
        }
      })
    });

    // Target Database (DB2)
    const targetDatabase = new rds.DatabaseInstance(this, 'TargetDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      subnetGroup: dbSubnetGroup,
      securityGroups: [dbSecurityGroup],
      databaseName: 'targetdb',
      credentials: rds.Credentials.fromGeneratedSecret('cdcuser', {
        secretName: 'cdc/target-db-credentials'
      }),
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // DMS subnet group
    const dmsSubnetGroup = new dms.CfnReplicationSubnetGroup(this, 'DmsSubnetGroup', {
      replicationSubnetGroupDescription: 'Subnet group for DMS replication instance',
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
      replicationSubnetGroupIdentifier: 'cdc-dms-subnet-group'
    });

    // DMS IAM roles
    const dmsVpcRole = new iam.Role(this, 'DmsVpcRole', {
      assumedBy: new iam.ServicePrincipal('dms.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonDMSVPCManagementRole')
      ],
      roleName: 'dms-vpc-role'
    });

    const dmsCloudWatchRole = new iam.Role(this, 'DmsCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('dms.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonDMSCloudWatchLogsRole')
      ],
      roleName: 'dms-cloudwatch-logs-role'
    });

    // DMS replication instance
    const replicationInstance = new dms.CfnReplicationInstance(this, 'DmsReplicationInstance', {
      replicationInstanceClass: 'dms.t3.micro',
      replicationInstanceIdentifier: 'cdc-replication-instance',
      replicationSubnetGroupIdentifier: dmsSubnetGroup.ref,
      vpcSecurityGroupIds: [dmsSecurityGroup.securityGroupId],
      publiclyAccessible: false,
      multiAz: false
    });

    replicationInstance.addDependency(dmsSubnetGroup);

    // Source endpoint
    const sourceEndpoint = new dms.CfnEndpoint(this, 'SourceEndpoint', {
      endpointType: 'source',
      engineName: 'mysql',
      endpointIdentifier: 'cdc-source-endpoint',
      serverName: sourceDatabase.instanceEndpoint.hostname,
      port: 3306,
      databaseName: 'sourcedb',
      username: 'cdcuser',
      password: sourceDatabase.secret!.secretValueFromJson('password').unsafeUnwrap()
    });

    // Target endpoint
    const targetEndpoint = new dms.CfnEndpoint(this, 'TargetEndpoint', {
      endpointType: 'target',
      engineName: 'mysql',
      endpointIdentifier: 'cdc-target-endpoint',
      serverName: targetDatabase.instanceEndpoint.hostname,
      port: 3306,
      databaseName: 'targetdb',
      username: 'cdcuser',
      password: targetDatabase.secret!.secretValueFromJson('password').unsafeUnwrap()
    });

    // CloudWatch log group for DMS
    const dmsLogGroup = new logs.LogGroup(this, 'DmsLogGroup', {
      logGroupName: '/aws/dms/cdc-replication-task',
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK
    });

    // DMS replication task
    const replicationTask = new dms.CfnReplicationTask(this, 'DmsReplicationTask', {
      replicationTaskIdentifier: 'cdc-replication-task',
      sourceEndpointArn: sourceEndpoint.ref,
      targetEndpointArn: targetEndpoint.ref,
      replicationInstanceArn: replicationInstance.ref,
      migrationType: 'full-load-and-cdc',
      tableMappings: JSON.stringify({
        rules: [
          {
            "rule-type": "selection",
            "rule-id": "1",
            "rule-name": "1",
            "object-locator": {
              "schema-name": "sourcedb",
              "table-name": "%"
            },
            "rule-action": "include"
          }
        ]
      }),
      replicationTaskSettings: JSON.stringify({
        "Logging": {
          "EnableLogging": true,
          "LogComponents": [
            {
              "Id": "SOURCE_UNLOAD",
              "Severity": "LOGGER_SEVERITY_DEFAULT"
            },
            {
              "Id": "TARGET_LOAD",
              "Severity": "LOGGER_SEVERITY_DEFAULT"
            },
            {
              "Id": "SOURCE_CAPTURE",
              "Severity": "LOGGER_SEVERITY_DEFAULT"
            },
            {
              "Id": "TARGET_APPLY",
              "Severity": "LOGGER_SEVERITY_DEFAULT"
            }
          ]
        },
        "CloudWatchLogGroup": dmsLogGroup.logGroupName,
        "CloudWatchLogStream": "cdc-replication-task-stream"
      })
    });

    // Outputs
    new CfnOutput(this, 'SourceDatabaseEndpoint', {
      value: sourceDatabase.instanceEndpoint.hostname,
      description: 'Source database endpoint'
    });

    new CfnOutput(this, 'TargetDatabaseEndpoint', {
      value: targetDatabase.instanceEndpoint.hostname,
      description: 'Target database endpoint'
    });

    new CfnOutput(this, 'SourceDatabaseSecret', {
      value: sourceDatabase.secret!.secretArn,
      description: 'Source database credentials secret ARN'
    });

    new CfnOutput(this, 'TargetDatabaseSecret', {
      value: targetDatabase.secret!.secretArn,
      description: 'Target database credentials secret ARN'
    });

    new CfnOutput(this, 'ReplicationTaskArn', {
      value: replicationTask.ref,
      description: 'DMS replication task ARN'
    });
  }
}
