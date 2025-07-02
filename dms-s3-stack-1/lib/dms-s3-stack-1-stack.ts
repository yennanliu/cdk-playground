import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dms from "aws-cdk-lib/aws-dms";
import { Construct } from "constructs";

export class DmsS3Stack1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC for our resources
    const vpc = new ec2.Vpc(this, "DmsVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create S3 bucket for CDC data
    const cdcBucket = new s3.Bucket(this, "CdcBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development/testing
      autoDeleteObjects: true, // For development/testing
      versioned: true,
    });

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

    // Create RDS instance
    const rdsInstance = new rds.DatabaseInstance(this, "MySQLInstance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: 20,
      securityGroups: [rdsSecurityGroup],
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development/testing
      deletionProtection: false, // For development/testing
      publiclyAccessible: true, // As per requirement 8
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

    const dmsSecurityGroup = new ec2.SecurityGroup(this, "DmsSecurityGroup", {
      vpc,
      description: "Security group for DMS replication instance",
      allowAllOutbound: true,
    });

    const dmsRole = new iam.Role(this, "DmsS3Role", {
      assumedBy: new iam.ServicePrincipal("dms.amazonaws.com"),
    });

    // Grant DMS permissions to write to S3
    cdcBucket.grantReadWrite(dmsRole);

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

    // Create DMS target endpoint (S3)
    const targetEndpoint = new dms.CfnEndpoint(this, "TargetEndpoint", {
      endpointType: "target",
      engineName: "s3",
      s3Settings: {
        bucketName: cdcBucket.bucketName,
        serviceAccessRoleArn: dmsRole.roleArn,
      },
    });

    // Create DMS replication task
    new dms.CfnReplicationTask(this, "DmsReplicationTask", {
      replicationInstanceArn: replicationInstance.ref,
      sourceEndpointArn: sourceEndpoint.ref,
      targetEndpointArn: targetEndpoint.ref,
      migrationType: "full-load-and-cdc",
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
        FullLoadSettings: {
          TargetTablePrepMode: "DO_NOTHING",
        },
        Logging: {
          EnableLogging: true,
        },
      }),
    });

    // Output important information
    new cdk.CfnOutput(this, "RdsEndpoint", {
      value: rdsInstance.instanceEndpoint.hostname,
      description: "RDS instance endpoint",
    });

    new cdk.CfnOutput(this, "S3BucketName", {
      value: cdcBucket.bucketName,
      description: "S3 bucket for CDC data",
    });

    new cdk.CfnOutput(this, "RdsSecretName", {
      value: rdsInstance.secret?.secretName || "No secret created",
      description: "Secret name for RDS credentials",
    });
  }
}
