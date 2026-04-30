import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

const MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
const LAMBDA_TIMEOUT = Duration.seconds(300);
const BUNDLING = { externalModules: ['@aws-sdk/*'] };

export class AgentTeamStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Shared state: each task gets a row per agent role
    const table = new dynamodb.Table(this, 'AgentTable', {
      tableName: 'agent-team-tasks',
      partitionKey: { name: 'taskId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'agentRole', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Queues for specialist agents
    const backendQueue = new sqs.Queue(this, 'BackendQueue', {
      queueName: 'agent-backend-queue',
      visibilityTimeout: LAMBDA_TIMEOUT,
    });

    const frontendQueue = new sqs.Queue(this, 'FrontendQueue', {
      queueName: 'agent-frontend-queue',
      visibilityTimeout: LAMBDA_TIMEOUT,
    });

    const bedrockPolicy = new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    });

    // PM Agent — entry point via Function URL; plans & delegates to specialist queues
    const pmAgent = new lambdaNodejs.NodejsFunction(this, 'PmAgent', {
      functionName: 'agent-pm',
      entry: 'lambda/pm-agent.ts',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: LAMBDA_TIMEOUT,
      bundling: BUNDLING,
      environment: {
        TABLE_NAME: table.tableName,
        BACKEND_QUEUE_URL: backendQueue.queueUrl,
        FRONTEND_QUEUE_URL: frontendQueue.queueUrl,
        MODEL_ID,
      },
    });

    // Backend Engineer Agent — triggered by SQS
    const backendAgent = new lambdaNodejs.NodejsFunction(this, 'BackendAgent', {
      functionName: 'agent-backend-eng',
      entry: 'lambda/backend-agent.ts',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: LAMBDA_TIMEOUT,
      bundling: BUNDLING,
      environment: { TABLE_NAME: table.tableName, MODEL_ID },
    });

    // Frontend Engineer Agent — triggered by SQS
    const frontendAgent = new lambdaNodejs.NodejsFunction(this, 'FrontendAgent', {
      functionName: 'agent-frontend-eng',
      entry: 'lambda/frontend-agent.ts',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: LAMBDA_TIMEOUT,
      bundling: BUNDLING,
      environment: { TABLE_NAME: table.tableName, MODEL_ID },
    });

    // Permissions
    [pmAgent, backendAgent, frontendAgent].forEach(fn => {
      fn.addToRolePolicy(bedrockPolicy);
      table.grantReadWriteData(fn);
    });
    backendQueue.grantSendMessages(pmAgent);
    frontendQueue.grantSendMessages(pmAgent);

    // Wire SQS → specialist agents
    backendAgent.addEventSource(new SqsEventSource(backendQueue, { batchSize: 1 }));
    frontendAgent.addEventSource(new SqsEventSource(frontendQueue, { batchSize: 1 }));

    // HTTP entry point for submitting tasks to PM
    const pmUrl = pmAgent.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    new CfnOutput(this, 'PmAgentUrl', { value: pmUrl.url, description: 'POST {message} here to kick off the agent team' });
    new CfnOutput(this, 'AgentTableName', { value: table.tableName });
  }
}
