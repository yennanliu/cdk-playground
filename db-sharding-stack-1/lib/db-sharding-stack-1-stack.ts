import {
  Duration,
  Stack,
  StackProps,
  RemovalPolicy,
  CfnOutput,
  CustomResource,
} from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class DbShardingStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create VPC for RDS instances
    const vpc = new ec2.Vpc(this, "ShardingVpc", {
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
      ],
    });

    // Security Group for RDS
    const rdsSecurityGroup = new ec2.SecurityGroup(this, "RdsSecurityGroup", {
      vpc,
      description: "Security group for RDS MySQL instances",
      allowAllOutbound: false,
    });

    // Security Group for Lambda
    const lambdaSecurityGroup = new ec2.SecurityGroup(
      this,
      "LambdaSecurityGroup",
      {
        vpc,
        description: "Security group for Lambda functions",
        allowAllOutbound: true,
      }
    );

    // Allow Lambda to connect to RDS
    rdsSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(3306),
      "Allow Lambda to connect to MySQL"
    );

    // DB Subnet Group
    const dbSubnetGroup = new rds.SubnetGroup(this, "DbSubnetGroup", {
      vpc,
      description: "Subnet group for RDS instances",
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Create multiple RDS shards (2 instances)
    const shards: rds.DatabaseInstance[] = [];
    const shardCount = 2;

    for (let i = 0; i < shardCount; i++) {
      const shard = new rds.DatabaseInstance(this, `MySqlShard${i}`, {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_0,
        }),
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.MICRO
        ),
        vpc,
        subnetGroup: dbSubnetGroup,
        securityGroups: [rdsSecurityGroup],
        databaseName: `shard${i}db`,
        credentials: rds.Credentials.fromGeneratedSecret("admin", {
          secretName: `mysql-shard-${i}-credentials`,
        }),
        allocatedStorage: 20,
        storageEncrypted: true,
        backupRetention: Duration.days(1),
        deleteAutomatedBackups: true,
        deletionProtection: false,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      shards.push(shard);
    }

    // DynamoDB table for shard metadata
    const shardMetadataTable = new dynamodb.Table(this, "ShardMetadataTable", {
      tableName: "shard_metadata",
      partitionKey: { name: "shardId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Lambda function for Shard Manager
    const shardManager = new lambda.Function(this, "ShardManagerFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "shard-manager.handler",
      code: lambda.Code.fromAsset("lib/lambda"),
      environment: {
        SHARD_TABLE: shardMetadataTable.tableName,
        SHARD_COUNT: shardCount.toString(),
      },
      timeout: Duration.seconds(30),
      vpc,
      securityGroups: [lambdaSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Grant Lambda permissions to access DynamoDB
    shardMetadataTable.grantReadWriteData(shardManager);

    // Grant Lambda permissions to access Secrets Manager
    shardManager.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: shards.map((shard) => shard.secret?.secretArn || ""),
      })
    );

    // Create API Gateway
    const httpApi = new apigateway.HttpApi(this, "ShardingApi", {
      apiName: "db-sharding-api",
    });

    // Create Lambda integration
    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      "ShardManagerIntegration",
      shardManager
    );

    // Add routes
    httpApi.addRoutes({
      path: "/user",
      methods: [apigateway.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/user/{userId}",
      methods: [apigateway.HttpMethod.GET],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/shards",
      methods: [apigateway.HttpMethod.GET],
      integration: lambdaIntegration,
    });

    // Custom resource Lambda to populate DynamoDB with shard metadata
    const populateShards = new lambda.Function(this, "PopulateShardsFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "populate-shards.handler",
      code: lambda.Code.fromAsset("lib/lambda"),
      timeout: Duration.seconds(60),
    });

    shardMetadataTable.grantReadWriteData(populateShards);

    // Create custom resource to populate shard metadata
    const shardData = shards.map((shard, index) => ({
      shardId: index.toString(),
      rdsEndpoint: shard.instanceEndpoint.hostname,
      dbName: `shard${index}db`,
      secretArn: shard.secret?.secretArn || "",
      status: "active",
    }));

    // Create custom resource to populate shard metadata
    const populateShardsResource = new CustomResource(this, "PopulateShardsResource", {
      serviceToken: populateShards.functionArn,
      properties: {
        TableName: shardMetadataTable.tableName,
        Shards: JSON.stringify(shardData),
      },
    });

    // Ensure custom resource runs after DynamoDB table and RDS instances are created
    populateShardsResource.node.addDependency(shardMetadataTable);
    shards.forEach(shard => {
      populateShardsResource.node.addDependency(shard);
    });

    // Output the API Gateway URL
    new CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
      description: "API Gateway endpoint URL",
    });

    new CfnOutput(this, "DynamoTableName", {
      value: shardMetadataTable.tableName,
      description: "DynamoDB table name for shard metadata",
    });
  }
}
