import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import * as RagStack1 from '../lib/rag_stack_1-stack';

test('stack synthesizes the core RAG resources', () => {
  const app = new cdk.App();
  const stack = new RagStack1.RagStack1Stack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // docs + web buckets (may be more once auto-delete / deployment helpers are added).
  template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
  template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 1);
  template.resourceCountIs('AWS::Bedrock::DataSource', 1);
});
