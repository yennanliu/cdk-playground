// Cron sync — fired by EventBridge on a schedule; ingests new docs into the Knowledge Base.
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';

const client = new BedrockAgentClient({});

export async function handler() {
  const res = await client.send(new StartIngestionJobCommand({
    knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID!,
    dataSourceId: process.env.DATA_SOURCE_ID!,
  }));
  return {
    ingestionJobId: res.ingestionJob?.ingestionJobId,
    status: res.ingestionJob?.status,
  };
}
