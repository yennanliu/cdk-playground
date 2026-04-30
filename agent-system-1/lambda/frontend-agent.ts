import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const { TABLE_NAME, MODEL_ID } = process.env as Record<string, string>;

const SYSTEM_PROMPT = `You are a Senior Frontend Engineer AI agent.
Given a frontend task, provide a concise technical implementation plan covering:
- Component hierarchy and page structure
- State management approach
- Key UI interactions and user flows
- API integration points (matching the backend contract)
- Accessibility and responsiveness notes
Be specific and actionable. Use markdown for clarity.`;

async function invokeBedrock(task: string): Promise<string> {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: task }],
    }),
  }));
  const body = JSON.parse(new TextDecoder().decode(res.body));
  return body.content[0].text;
}

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const { taskId, task } = JSON.parse(record.body) as { taskId: string; task: string };

    const output = await invokeBedrock(task);

    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { taskId, agentRole: 'frontend', task, output, completedAt: new Date().toISOString() },
    }));

    console.log(`[Frontend Eng] taskId=${taskId} done`);
  }
};
