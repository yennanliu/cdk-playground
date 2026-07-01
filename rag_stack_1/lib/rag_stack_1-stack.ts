import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';
import { Storage } from './constructs/storage';
import { KnowledgeBase } from './constructs/knowledge-base';
import { Api } from './constructs/api';

export class RagStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Config (override with `cdk deploy -c key=value`) ---
    const appPassword = this.node.tryGetContext('appPassword') ?? 'change-me-dev';
    // Newer Claude models on Bedrock must be invoked via an INFERENCE PROFILE, not a
    // bare foundation-model ARN (foundation-model ARNs fail with "on-demand throughput
    // isn't supported"). Default to a cross-region ("global") Sonnet profile; override
    // the id with `-c modelId=...` or the whole ARN with `-c modelArn=...`.
    const modelId = this.node.tryGetContext('modelId') ?? 'global.anthropic.claude-sonnet-4-6';
    const modelArn = this.node.tryGetContext('modelArn')
      ?? `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${modelId}`;

    // --- Constructs ---
    const storage = new Storage(this, 'Storage');

    const kb = new KnowledgeBase(this, 'KnowledgeBase', {
      docsBucket: storage.docsBucket,
    });

    const api = new Api(this, 'Api', {
      docsBucket: storage.docsBucket,
      knowledgeBaseId: kb.knowledgeBase.knowledgeBaseId,
      knowledgeBaseArn: kb.knowledgeBase.knowledgeBaseArn,
      modelArn,
      appPassword,
    });

    // --- Static SPA + runtime config (apiUrl resolved at deploy time) ---
    new s3deploy.BucketDeployment(this, 'WebDeploy', {
      destinationBucket: storage.webBucket,
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', 'web')),
        s3deploy.Source.jsonData('config.json', { apiUrl: api.httpApi.apiEndpoint }),
      ],
    });

    // --- Outputs ---
    new CfnOutput(this, 'WebsiteUrl', { value: storage.webBucket.bucketWebsiteUrl });
    new CfnOutput(this, 'DocsBucketName', { value: storage.docsBucket.bucketName });
    new CfnOutput(this, 'KnowledgeBaseId', { value: kb.knowledgeBase.knowledgeBaseId });
  }
}
