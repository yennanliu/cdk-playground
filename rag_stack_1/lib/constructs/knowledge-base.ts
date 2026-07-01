import { Duration } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { Construct } from 'constructs';
import { appFunction } from './fn';

export interface KnowledgeBaseProps {
  docsBucket: s3.IBucket;
  /** How often the cron sync ingests new docs. Default: 15 minutes. */
  syncEvery?: Duration;
}

// Bedrock Knowledge Base backed by OpenSearch Serverless (created by the L2 construct),
// with the docs bucket as its S3 data source and a cron Lambda that triggers ingestion.
export class KnowledgeBase extends Construct {
  readonly knowledgeBase: bedrock.VectorKnowledgeBase;
  readonly dataSource: bedrock.S3DataSource;

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    this.knowledgeBase = new bedrock.VectorKnowledgeBase(this, 'Kb', {
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
      instruction: 'Answer questions using the uploaded documents, and cite the sources.',
    });

    this.dataSource = new bedrock.S3DataSource(this, 'DocsSource', {
      bucket: props.docsBucket,
      knowledgeBase: this.knowledgeBase,
      dataSourceName: 'docs',
    });

    // Cron sync: EventBridge schedule -> sync Lambda -> StartIngestionJob.
    const sync = appFunction(this, 'SyncFn', 'sync.ts', {
      KNOWLEDGE_BASE_ID: this.knowledgeBase.knowledgeBaseId,
      DATA_SOURCE_ID: this.dataSource.dataSourceId,
    });
    sync.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:StartIngestionJob'],
      resources: [this.knowledgeBase.knowledgeBaseArn],
    }));

    new events.Rule(this, 'SyncSchedule', {
      schedule: events.Schedule.rate(props.syncEvery ?? Duration.minutes(15)),
      targets: [new targets.LambdaFunction(sync)],
    });
  }
}
