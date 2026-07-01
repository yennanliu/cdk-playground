// POST /query — retrieval-augmented answer with citations via Bedrock RetrieveAndGenerate.
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

const client = new BedrockAgentRuntimeClient({});
const KB_ID = process.env.KNOWLEDGE_BASE_ID!;
const MODEL_ARN = process.env.MODEL_ARN!;

export async function handler(event: any) {
  let question: string | undefined;
  try { question = JSON.parse(event.body ?? '{}').question; } catch { /* ignore */ }
  if (!question) return resp(400, { error: 'question required' });

  const out = await client.send(new RetrieveAndGenerateCommand({
    input: { text: question },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: { knowledgeBaseId: KB_ID, modelArn: MODEL_ARN },
    },
  }));

  const citations = (out.citations ?? [])
    .flatMap((c) => c.retrievedReferences ?? [])
    .map((r) => r.location?.s3Location?.uri)
    .filter((u): u is string => Boolean(u));

  return resp(200, { answer: out.output?.text ?? '', citations: [...new Set(citations)] });
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
