import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Config } from './config';

/** One Anthropic-format message. Content is a string or a block array. */
export interface Turn {
  role: 'user' | 'assistant';
  content: unknown;
}

/**
 * Conversation state, keyed by Slack thread.
 *
 * Keeping this out of process memory is what lets Phase 1 run more than one
 * gateway. The `ttl` attribute lets DynamoDB expire old threads so memory stays
 * bounded without a sweeper.
 */
export class Sessions {
  private readonly doc: DynamoDBDocumentClient;

  constructor(private readonly config: Config) {
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }));
  }

  static key(channel: string, thread: string): string {
    return `${channel}#${thread}`;
  }

  async history(pk: string): Promise<Turn[]> {
    const result = await this.doc.send(
      new GetCommand({ TableName: this.config.sessionsTable, Key: { pk } }),
    );
    return (result.Item?.turns as Turn[] | undefined) ?? [];
  }

  async save(pk: string, turns: Turn[]): Promise<void> {
    // Keep the tail only. A thread that runs for days should not grow an
    // unbounded row, and the oldest turns are the least useful.
    const trimmed = turns.slice(-40);
    await this.doc.send(
      new PutCommand({
        TableName: this.config.sessionsTable,
        Item: {
          pk,
          turns: trimmed,
          updatedAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + this.config.sessionTtlSeconds,
        },
      }),
    );
  }
}
