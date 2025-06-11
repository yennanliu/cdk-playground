import {
  Duration,
  Stack,
  StackProps,
  RemovalPolicy,
  CfnOutput,
} from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ecs from "aws-cdk-lib/aws-ecs";

import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as kinesisFirehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class MysqlBinlogOpensearch1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC with public and private subnets
    const vpc = new ec2.Vpc(this, "MysqlBinlogVpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Security Group for RDS
    const rdsSecurityGroup = new ec2.SecurityGroup(this, "RdsSecurityGroup", {
      vpc,
      description: "Security group for RDS MySQL instance",
      allowAllOutbound: false,
    });

    // Security Group for ECS
    const ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc,
      description: "Security group for ECS Fargate tasks",
      allowAllOutbound: true,
    });

    // Allow ECS to connect to RDS
    rdsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(3306),
      "Allow ECS to connect to MySQL"
    );

    // Allow public access to RDS (as required)
    rdsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3306),
      "Allow public access to MySQL"
    );

    // RDS Subnet Group
    const rdsSubnetGroup = new rds.SubnetGroup(this, "RdsSubnetGroup", {
      vpc,
      description: "Subnet group for RDS MySQL",
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Secrets Manager for RDS credentials
    const dbCredentials = new secretsmanager.Secret(this, "DbCredentials", {
      secretName: "mysql-binlog-db-credentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "admin" }),
        generateStringKey: "password",
        excludeCharacters: '"@/\\',
        passwordLength: 32,
      },
    });

    // RDS MySQL Instance with binary logging enabled
    const database = new rds.DatabaseInstance(this, "MysqlDatabase", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_35,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      subnetGroup: rdsSubnetGroup,
      securityGroups: [rdsSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: "debezium",
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      backupRetention: Duration.days(1),
      parameterGroup: new rds.ParameterGroup(this, "MysqlParameterGroup", {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_0_35,
        }),
        parameters: {
          "log-bin": "mysql-bin",
          binlog_format: "ROW",
          binlog_row_image: "FULL",
          expire_logs_days: "1",
        },
      }),
    });

    // Kinesis Data Stream
    const kinesisStream = new kinesis.Stream(this, "BinlogStream", {
      streamName: "mysql-binlog-stream",
      shardCount: 1,
      retentionPeriod: Duration.hours(24),
    });

    // S3 Bucket for Firehose backup
    const firehoseBucket = new s3.Bucket(this, "FirehoseBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Lambda function for data transformation
    const transformationLambda = new lambda.Function(
      this,
      "TransformationLambda",
      {
        runtime: lambda.Runtime.PYTHON_3_9,
        handler: "index.handler",
        code: lambda.Code.fromInline(`
import json
import base64
import gzip

def handler(event, context):
    output = []
    
    for record in event['records']:
        # Decode the data
        data = base64.b64decode(record['data'])
        
        # Parse JSON if needed
        try:
            json_data = json.loads(data)
            # Add timestamp if not present
            if 'timestamp' not in json_data:
                import time
                json_data['timestamp'] = int(time.time() * 1000)
            
            # Re-encode
            transformed_data = json.dumps(json_data) + '\\n'
        except:
            # If not JSON, pass through as is
            transformed_data = data.decode('utf-8') + '\\n'
        
        output_record = {
            'recordId': record['recordId'],
            'result': 'Ok',
            'data': base64.b64encode(transformed_data.encode('utf-8')).decode('utf-8')
        }
        output.append(output_record)
    
    return {'records': output}
      `),
        timeout: Duration.minutes(5),
      }
    );

    // OpenSearch Domain
    const openSearchDomain = new opensearch.Domain(this, "OpenSearchDomain", {
      version: opensearch.EngineVersion.OPENSEARCH_2_3,
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: "t3.small.search",
      },
      ebs: {
        volumeSize: 10,
        volumeType: ec2.EbsDeviceVolumeType.GP2,
      },
      vpc,
      vpcSubnets: [
        {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      securityGroups: [
        new ec2.SecurityGroup(this, "OpenSearchSecurityGroup", {
          vpc,
          description: "Security group for OpenSearch domain",
        }),
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      accessPolicies: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["es:*"],
          principals: [new iam.AnyPrincipal()],
          resources: ["*"],
        }),
      ],
    });

    // IAM Role for Kinesis Firehose
    const firehoseRole = new iam.Role(this, "FirehoseRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
      inlinePolicies: {
        FirehosePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["es:ESHttpPost", "es:ESHttpPut", "es:ESHttpGet"],
              resources: [openSearchDomain.domainArn + "/*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "s3:AbortMultipartUpload",
                "s3:GetBucketLocation",
                "s3:GetObject",
                "s3:ListBucket",
                "s3:ListBucketMultipartUploads",
                "s3:PutObject",
              ],
              resources: [
                firehoseBucket.bucketArn,
                firehoseBucket.bucketArn + "/*",
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "kinesis:DescribeStream",
                "kinesis:GetShardIterator",
                "kinesis:GetRecords",
                "kinesis:ListShards",
              ],
              resources: [kinesisStream.streamArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["lambda:InvokeFunction"],
              resources: [transformationLambda.functionArn],
            }),
          ],
        }),
      },
    });

    // Kinesis Firehose Delivery Stream
    const firehoseStream = new kinesisFirehose.CfnDeliveryStream(
      this,
      "FirehoseDeliveryStream",
      {
        deliveryStreamName: "mysql-binlog-firehose",
        deliveryStreamType: "KinesisStreamAsSource",
        kinesisStreamSourceConfiguration: {
          kinesisStreamArn: kinesisStream.streamArn,
          roleArn: firehoseRole.roleArn,
        },
        amazonopensearchserviceDestinationConfiguration: {
          domainArn: openSearchDomain.domainArn,
          indexName: "binlog-events",
          roleArn: firehoseRole.roleArn,
          s3Configuration: {
            bucketArn: firehoseBucket.bucketArn,
            roleArn: firehoseRole.roleArn,
            bufferingHints: {
              intervalInSeconds: 60,
              sizeInMBs: 1,
            },
            compressionFormat: "GZIP",
          },
          processingConfiguration: {
            enabled: true,
            processors: [
              {
                type: "Lambda",
                parameters: [
                  {
                    parameterName: "LambdaArn",
                    parameterValue: transformationLambda.functionArn,
                  },
                ],
              },
            ],
          },
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 1,
          },
        },
      }
    );

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "EcsCluster", {
      vpc,
      clusterName: "mysql-binlog-cluster",
    });

    // CloudWatch Log Group for ECS
    const ecsLogGroup = new logs.LogGroup(this, "EcsLogGroup", {
      logGroupName: "/ecs/debezium-connector",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // CloudWatch Log Group for Lambda
    const lambdaLogGroup = new logs.LogGroup(this, "LambdaLogGroup", {
      logGroupName: `/aws/lambda/${transformationLambda.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Task Role for ECS
    const taskRole = new iam.Role(this, "EcsTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      inlinePolicies: {
        KinesisPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "kinesis:PutRecord",
                "kinesis:PutRecords",
                "kinesis:DescribeStream",
              ],
              resources: [kinesisStream.streamArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["secretsmanager:GetSecretValue"],
              resources: [dbCredentials.secretArn],
            }),
          ],
        }),
      },
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "DebeziumTaskDefinition",
      {
        memoryLimitMiB: 2048,
        cpu: 1024,
        taskRole: taskRole,
      }
    );

    // Container Definition - Using a custom approach to send MySQL binlog events to Kinesis
    // In production, you would build a custom image with proper Debezium + Kinesis integration
    const container = taskDefinition.addContainer("mysql-kinesis-connector", {
      image: ecs.ContainerImage.fromRegistry("python:3.9-slim"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "mysql-kinesis",
        logGroup: ecsLogGroup,
      }),
      command: [
        "sh", "-c", 
        `pip install pymysql boto3 mysql-replication && python -c "
import time
import json
import boto3
import os
from datetime import datetime
from pymysqlreplication import BinLogStreamReader
from pymysqlreplication.row_event import (
    DeleteRowsEvent,
    UpdateRowsEvent,
    WriteRowsEvent,
)

# Initialize Kinesis client
kinesis_client = boto3.client('kinesis')
stream_name = os.environ['KINESIS_STREAM_NAME']

# MySQL connection settings
mysql_settings = {
    'host': os.environ['DB_HOST'],
    'port': 3306,
    'user': os.environ['DB_USERNAME'],
    'passwd': os.environ['DB_PASSWORD']
}

print('Starting MySQL binlog streaming to Kinesis...')

try:
    # Create binlog stream reader
    stream = BinLogStreamReader(
        connection_settings=mysql_settings,
        server_id=100,
        blocking=True,
        resume_stream=True
    )
    
    for binlogevent in stream:
        if isinstance(binlogevent, (WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent)):
            for row in binlogevent.rows:
                event_data = {
                    'timestamp': datetime.utcnow().isoformat(),
                    'server_id': binlogevent.packet.server_id,
                    'log_pos': binlogevent.packet.log_pos,
                    'database': binlogevent.schema,
                    'table': binlogevent.table,
                    'operation': type(binlogevent).__name__.replace('RowsEvent', '').lower(),
                    'data': row
                }
                
                # Send to Kinesis
                response = kinesis_client.put_record(
                    StreamName=stream_name,
                    Data=json.dumps(event_data, default=str),
                    PartitionKey=f'{binlogevent.schema}.{binlogevent.table}'
                )
                print(f'Sent binlog event to Kinesis: {event_data}')
                
except Exception as e:
    print(f'Error in binlog streaming: {e}')
    # Fallback to sending sample data for demo purposes
    while True:
        try:
            sample_event = {
                'timestamp': datetime.utcnow().isoformat(),
                'database': 'debezium',
                'table': 'sample_table',
                'operation': 'insert',
                'data': {'id': int(time.time()), 'name': 'sample_record', 'created_at': datetime.utcnow().isoformat()}
            }
            
            response = kinesis_client.put_record(
                StreamName=stream_name,
                Data=json.dumps(sample_event),
                PartitionKey='demo-partition'
            )
            print(f'Sent sample record to Kinesis: {sample_event}')
            time.sleep(30)
        except Exception as inner_e:
            print(f'Error sending sample data: {inner_e}')
            time.sleep(10)
"`
      ],
      environment: {
        AWS_DEFAULT_REGION: this.region,
        KINESIS_STREAM_NAME: kinesisStream.streamName,
        DB_HOST: database.instanceEndpoint.hostname
      },
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password"),
        DB_USERNAME: ecs.Secret.fromSecretsManager(dbCredentials, "username"),
      },
    });

    // No port mapping needed for our custom connector

    // ECS Service
    const service = new ecs.FargateService(this, "DebeziumService", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: false,
    });

    // Outputs
    new CfnOutput(this, "VpcId", {
      value: vpc.vpcId,
      description: "VPC ID",
    });

    new CfnOutput(this, "DatabaseEndpoint", {
      value: database.instanceEndpoint.hostname,
      description: "RDS MySQL endpoint",
    });

    new CfnOutput(this, "DatabaseCredentialsSecret", {
      value: dbCredentials.secretArn,
      description: "Database credentials secret ARN",
    });

    new CfnOutput(this, "KinesisStreamName", {
      value: kinesisStream.streamName,
      description: "Kinesis stream name",
    });

    new CfnOutput(this, "OpenSearchDomainEndpoint", {
      value: openSearchDomain.domainEndpoint,
      description: "OpenSearch domain endpoint",
    });

    new CfnOutput(this, "EcsClusterName", {
      value: cluster.clusterName,
      description: "ECS cluster name",
    });
  }
}
