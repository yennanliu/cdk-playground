import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

const { TABLE_NAME, BACKEND_QUEUE_URL, FRONTEND_QUEUE_URL, MODEL_ID } = process.env as Record<string, string>;

const SYSTEM_PROMPT = `You are a Project Manager AI agent leading a small engineering team.
Given a feature request, produce a concise plan by responding ONLY with valid JSON (no prose):
{
  "summary": "<one-line project summary>",
  "backendTask": "<specific task description for the backend engineer>",
  "frontendTask": "<specific task description for the frontend engineer>"
}`;

async function invokeBedrock(userMessage: string): Promise<{ summary: string; backendTask: string; frontendTask: string }> {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  }));
  const body = JSON.parse(new TextDecoder().decode(res.body));
  return JSON.parse(body.content[0].text);
}

export const handler = async (event: APIGatewayProxyEventV2) => {
  const body = JSON.parse(event.body ?? '{}');
  const message: string = body.message;

  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'message is required' }) };
  }

  const taskId = randomUUID();
  const plan = await invokeBedrock(message);

  // Store PM plan
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { taskId, agentRole: 'pm', plan, originalRequest: message, createdAt: new Date().toISOString() },
  }));

  // Delegate to specialist agents via SQS
  await Promise.all([
    sqs.send(new SendMessageCommand({ QueueUrl: BACKEND_QUEUE_URL, MessageBody: JSON.stringify({ taskId, task: plan.backendTask }) })),
    sqs.send(new SendMessageCommand({ QueueUrl: FRONTEND_QUEUE_URL, MessageBody: JSON.stringify({ taskId, task: plan.frontendTask }) })),
  ]);

  console.log(`[PM] taskId=${taskId} summary="${plan.summary}"`);
  return {
    statusCode: 202,
    body: JSON.stringify({ taskId, plan }),
  };
};
