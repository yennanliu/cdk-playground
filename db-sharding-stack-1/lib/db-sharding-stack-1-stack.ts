import { Duration, Stack, StackProps, RemovalPolicy } from "aws-cdk-lib";
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
      handler: "index.handler",
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const mysql = require('mysql2/promise');

const dynamodb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();

const SHARD_TABLE = process.env.SHARD_TABLE;
const SHARD_COUNT = parseInt(process.env.SHARD_COUNT);

// Hash function to determine shard
function getShardId(userId) {
  const hash = userId.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return Math.abs(hash) % SHARD_COUNT;
}

// Get shard metadata from DynamoDB
async function getShardMetadata(shardId) {
  const params = {
    TableName: SHARD_TABLE,
    Key: { shardId: shardId.toString() }
  };
  
  const result = await dynamodb.get(params).promise();
  return result.Item;
}

// Get RDS credentials from Secrets Manager
async function getDbCredentials(secretArn) {
  const secret = await secretsManager.getSecretValue({ SecretId: secretArn }).promise();
  return JSON.parse(secret.SecretString);
}

// Create MySQL connection
async function createConnection(shardMetadata) {
  const credentials = await getDbCredentials(shardMetadata.secretArn);
  
  return await mysql.createConnection({
    host: shardMetadata.rdsEndpoint,
    user: credentials.username,
    password: credentials.password,
    database: shardMetadata.dbName,
    ssl: { rejectUnauthorized: false }
  });
}

// Initialize user table in shard if not exists
async function initializeUserTable(connection) {
  await connection.execute(\`
    CREATE TABLE IF NOT EXISTS users (
      userId VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  \`);
}

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const { httpMethod, path, pathParameters, body } = event;
  
  try {
    // Handle different API endpoints
    if (httpMethod === 'GET' && path === '/shards') {
      // List all shards
      const params = {
        TableName: SHARD_TABLE
      };
      
      const result = await dynamodb.scan(params).promise();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shards: result.Items,
          totalShards: result.Count
        })
      };
    }
    
    if (httpMethod === 'POST' && path === '/user') {
      // Create new user
      const userData = JSON.parse(body);
      const { userId, name, email } = userData;
      
      if (!userId || !name) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'userId and name are required' })
        };
      }
      
      // Determine shard
      const shardId = getShardId(userId);
      const shardMetadata = await getShardMetadata(shardId);
      
      if (!shardMetadata) {
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Shard metadata not found' })
        };
      }
      
      // Connect to shard and create user
      const connection = await createConnection(shardMetadata);
      await initializeUserTable(connection);
      
      await connection.execute(
        'INSERT INTO users (userId, name, email) VALUES (?, ?, ?)',
        [userId, name, email || null]
      );
      
      await connection.end();
      
      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'User created successfully',
          userId,
          shardId
        })
      };
    }
    
    if (httpMethod === 'GET' && path.startsWith('/user/')) {
      // Get user by ID
      const userId = pathParameters.userId;
      
      if (!userId) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'userId is required' })
        };
      }
      
      // Determine shard
      const shardId = getShardId(userId);
      const shardMetadata = await getShardMetadata(shardId);
      
      if (!shardMetadata) {
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Shard metadata not found' })
        };
      }
      
      // Connect to shard and get user
      const connection = await createConnection(shardMetadata);
      await initializeUserTable(connection);
      
      const [rows] = await connection.execute(
        'SELECT * FROM users WHERE userId = ?',
        [userId]
      );
      
      await connection.end();
      
      if (rows.length === 0) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'User not found' })
        };
      }
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: rows[0],
          shardId
        })
      };
    }
    
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not found' })
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
      `),
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

    // Custom resource to populate DynamoDB with shard metadata
    const populateShards = new lambda.Function(this, "PopulateShardsFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  if (event.RequestType === 'Create' || event.RequestType === 'Update') {
    try {
      const shards = JSON.parse(event.ResourceProperties.Shards);
      
      for (const shard of shards) {
        const params = {
          TableName: event.ResourceProperties.TableName,
          Item: shard
        };
        
        await dynamodb.put(params).promise();
        console.log(\`Populated shard: \${shard.shardId}\`);
      }
      
      await sendResponse(event, 'SUCCESS', { message: 'Shards populated successfully' });
    } catch (error) {
      console.error('Error:', error);
      await sendResponse(event, 'FAILED', { error: error.message });
    }
  } else {
    await sendResponse(event, 'SUCCESS', { message: 'Delete operation completed' });
  }
};

async function sendResponse(event, status, data) {
  const responseBody = {
    Status: status,
    Reason: JSON.stringify(data),
    PhysicalResourceId: event.LogicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  };
  
  const https = require('https');
  const url = require('url');
  
  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': JSON.stringify(responseBody).length
    }
  };
  
  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      resolve(response.statusCode);
    });
    
    request.on('error', (error) => {
      reject(error);
    });
    
    request.write(JSON.stringify(responseBody));
    request.end();
  });
}
      `),
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

    new lambda.Function(this, "PopulateShardsCustomResource", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const response = require('cfn-response');
const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      const shards = JSON.parse(event.ResourceProperties.Shards);
      
      for (const shard of shards) {
        const params = {
          TableName: event.ResourceProperties.TableName,
          Item: shard
        };
        
        await dynamodb.put(params).promise();
        console.log(\`Populated shard: \${shard.shardId}\`);
      }
    }
    
    await response.send(event, context, response.SUCCESS, {
      message: 'Shards populated successfully'
    });
  } catch (error) {
    console.error('Error:', error);
    await response.send(event, context, response.FAILED, {
      error: error.message
    });
  }
};
      `),
      environment: {
        TABLE_NAME: shardMetadataTable.tableName,
        SHARDS: JSON.stringify(shardData),
      },
      timeout: Duration.seconds(60),
    });

    // Output the API Gateway URL
    new Stack(this, "ShardingApiUrl", {
      parameters: {
        ApiUrl: httpApi.apiEndpoint,
      },
    });
  }
}
