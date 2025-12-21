# AWS Bedrock AI Application Examples

A comprehensive guide to building AI applications using AWS Bedrock - the simplest patterns and architectures.

## Table of Contents

1. [Overview](#overview)
2. [Simple Examples](#simple-examples)
3. [Architecture Patterns](#architecture-patterns)
4. [Common Use Cases](#common-use-cases)
5. [Best Practices](#best-practices)

---

## Overview

AWS Bedrock provides serverless access to foundation models (FMs) from leading AI companies through a single API. No need to manage infrastructure - just invoke models and build applications.

### Available Models
- **Anthropic Claude** (Sonnet, Opus, Haiku) - Advanced reasoning, long context
- **Amazon Titan** - Text, embeddings, image generation
- **Meta Llama** - Open-source large language models
- **Cohere** - Command models, embeddings
- **AI21 Labs Jurassic** - Text generation
- **Stability AI** - Image generation (Stable Diffusion)

---

## Simple Examples

### 1. Text Generation API (Lambda + API Gateway)

**Architecture**: API Gateway → Lambda → Bedrock

**Use Case**: Simple chatbot or text completion service

```typescript
// Lambda handler example
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export const handler = async (event: any) => {
  const client = new BedrockRuntimeClient({ region: "us-east-1" });

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: JSON.parse(event.body).prompt
    }]
  };

  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
    body: JSON.stringify(payload)
  });

  const response = await client.send(command);
  const result = JSON.parse(Buffer.from(response.body).toString());

  return {
    statusCode: 200,
    body: JSON.stringify({ response: result.content[0].text })
  };
};
```

**CDK Stack Pattern**:
```typescript
const bedrockLambda = new lambda.Function(this, 'BedrockFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
  timeout: Duration.seconds(30),
  memorySize: 512
});

// Grant Bedrock permissions
bedrockLambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: ['arn:aws:bedrock:*::foundation-model/*']
}));

const api = new apigateway.LambdaRestApi(this, 'BedrockAPI', {
  handler: bedrockLambda
});
```

---

### 2. Document Q&A with RAG (Retrieval Augmented Generation)

**Architecture**: S3 (documents) → Lambda (embeddings) → OpenSearch → Lambda (Q&A) → Bedrock

**Use Case**: Answer questions based on your document library

**Key Components**:
1. **Document Ingestion**: Upload PDFs/docs to S3
2. **Embedding Generation**: Use Bedrock Titan Embeddings to vectorize content
3. **Vector Store**: Store in OpenSearch or Aurora pgvector
4. **Query Flow**: User question → Embedding → Vector search → Context retrieval → LLM answer

```typescript
// Simplified RAG Lambda
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { OpenSearchClient } from "@opensearch-project/opensearch";

async function generateEmbedding(text: string) {
  const command = new InvokeModelCommand({
    modelId: "amazon.titan-embed-text-v1",
    body: JSON.stringify({ inputText: text })
  });
  const response = await bedrockClient.send(command);
  return JSON.parse(Buffer.from(response.body).toString()).embedding;
}

async function searchSimilarDocs(queryEmbedding: number[]) {
  // Search OpenSearch for similar document chunks
  const results = await opensearchClient.search({
    index: 'documents',
    body: {
      query: {
        knn: { embedding: { vector: queryEmbedding, k: 3 } }
      }
    }
  });
  return results.hits.hits.map((hit: any) => hit._source.text);
}

export const handler = async (event: any) => {
  const question = JSON.parse(event.body).question;

  // 1. Generate embedding for question
  const queryEmbedding = await generateEmbedding(question);

  // 2. Find relevant documents
  const context = await searchSimilarDocs(queryEmbedding);

  // 3. Ask Claude with context
  const prompt = `Based on the following context, answer the question.

Context:
${context.join('\n\n')}

Question: ${question}`;

  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const response = await bedrockClient.send(command);
  return JSON.parse(Buffer.from(response.body).toString()).content[0].text;
};
```

---

### 3. Image Generation Service

**Architecture**: API Gateway → Lambda → Bedrock (Stable Diffusion)

**Use Case**: Generate images from text prompts

```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export const handler = async (event: any) => {
  const { prompt } = JSON.parse(event.body);

  const command = new InvokeModelCommand({
    modelId: "stability.stable-diffusion-xl-v1",
    body: JSON.stringify({
      text_prompts: [{ text: prompt }],
      cfg_scale: 10,
      steps: 50
    })
  });

  const response = await bedrockClient.send(command);
  const result = JSON.parse(Buffer.from(response.body).toString());

  // Save to S3
  const imageBuffer = Buffer.from(result.artifacts[0].base64, 'base64');
  const s3Key = `generated/${Date.now()}.png`;

  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: s3Key,
    Body: imageBuffer,
    ContentType: 'image/png'
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ imageUrl: `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${s3Key}` })
  };
};
```

---

### 4. Text Summarization Pipeline

**Architecture**: S3 Event → Lambda → Bedrock → DynamoDB

**Use Case**: Automatically summarize documents uploaded to S3

```typescript
import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

export const handler = async (event: S3Event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = record.s3.object.key;

    // Get document from S3
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const s3Response = await s3Client.send(getCommand);
    const documentText = await s3Response.Body?.transformToString();

    // Summarize with Bedrock
    const bedrockCommand = new InvokeModelCommand({
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: `Summarize this document in 3-5 bullet points:\n\n${documentText}`
        }]
      })
    });

    const bedrockResponse = await bedrockClient.send(bedrockCommand);
    const summary = JSON.parse(Buffer.from(bedrockResponse.body).toString()).content[0].text;

    // Store in DynamoDB
    await dynamoClient.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        documentKey: { S: key },
        summary: { S: summary },
        timestamp: { N: Date.now().toString() }
      }
    }));
  }
};
```

**CDK Pattern**:
```typescript
const summaryLambda = new lambda.Function(this, 'SummaryFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
  environment: {
    TABLE_NAME: summaryTable.tableName
  }
});

documentBucket.addEventNotification(
  s3.EventType.OBJECT_CREATED,
  new s3n.LambdaDestination(summaryLambda),
  { suffix: '.txt' }
);

summaryLambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: ['*']
}));

summaryTable.grantWriteData(summaryLambda);
documentBucket.grantRead(summaryLambda);
```

---

### 5. Chatbot with Conversation History

**Architecture**: API Gateway → Lambda → DynamoDB (history) → Bedrock

**Use Case**: Multi-turn chatbot that remembers context

```typescript
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

export const handler = async (event: any) => {
  const { sessionId, message } = JSON.parse(event.body);

  // Get conversation history
  const historyResponse = await dynamoClient.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: { sessionId: { S: sessionId } }
  }));

  const history = historyResponse.Item?.messages?.L?.map((m: any) =>
    JSON.parse(m.S)
  ) || [];

  // Add user message
  history.push({ role: "user", content: message });

  // Call Bedrock
  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      messages: history
    })
  });

  const response = await bedrockClient.send(command);
  const assistantMessage = JSON.parse(Buffer.from(response.body).toString()).content[0].text;

  // Save conversation
  history.push({ role: "assistant", content: assistantMessage });

  await dynamoClient.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      sessionId: { S: sessionId },
      messages: { L: history.map(m => ({ S: JSON.stringify(m) })) },
      lastUpdated: { N: Date.now().toString() }
    }
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ response: assistantMessage })
  };
};
```

---

### 6. Batch Content Classification

**Architecture**: EventBridge Schedule → Lambda → Bedrock → DynamoDB

**Use Case**: Classify customer feedback, social media posts, support tickets

```typescript
export const handler = async () => {
  // Get unprocessed items from DynamoDB
  const items = await getUnprocessedItems();

  for (const item of items) {
    const prompt = `Classify the following text into one of these categories:
    [Positive, Negative, Neutral, Question, Complaint, Feature Request]

    Text: ${item.content}

    Respond with just the category name.`;

    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 50,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const response = await bedrockClient.send(command);
    const category = JSON.parse(Buffer.from(response.body).toString()).content[0].text.trim();

    // Update item with classification
    await dynamoClient.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: { id: { S: item.id } },
      UpdateExpression: 'SET category = :category, processed = :processed',
      ExpressionAttributeValues: {
        ':category': { S: category },
        ':processed': { BOOL: true }
      }
    }));
  }
};
```

---

## Architecture Patterns

### Pattern 1: Synchronous API
```
Client → API Gateway → Lambda → Bedrock → Response
```
**Best for**: Real-time chat, instant text generation
**Cost**: Pay per request
**Latency**: 1-5 seconds

### Pattern 2: Asynchronous Processing
```
Client → API Gateway → SQS → Lambda → Bedrock → SNS → Client Notification
```
**Best for**: Long-running tasks, batch processing
**Cost**: Lower (queue + async invocation)
**Latency**: Variable

### Pattern 3: RAG (Retrieval Augmented Generation)
```
Documents → S3 → Lambda (embedding) → Vector DB → Lambda (query) → Bedrock
```
**Best for**: Knowledge base Q&A, document search
**Components**: S3, OpenSearch/Aurora pgvector, Lambda, Bedrock

### Pattern 4: Streaming Responses
```
Client → API Gateway WebSocket → Lambda → Bedrock (streaming) → WebSocket
```
**Best for**: Real-time chat with progressive responses
**User Experience**: Better for long responses

### Pattern 5: Agent with Tools
```
Client → Lambda → Bedrock (with tool definitions) → Lambda (tool execution) → Bedrock → Response
```
**Best for**: Complex workflows, function calling, data lookups

---

## Common Use Cases

### 1. Customer Support Chatbot
- **Models**: Claude Sonnet/Haiku
- **Features**: Conversation history, knowledge base integration
- **Architecture**: API Gateway + Lambda + DynamoDB + Bedrock

### 2. Content Generation Platform
- **Models**: Claude Opus for long-form, Stable Diffusion for images
- **Features**: Templates, style customization, batch generation
- **Architecture**: Step Functions orchestration + multiple Bedrock calls

### 3. Document Intelligence
- **Models**: Claude for analysis, Titan for embeddings
- **Features**: PDF extraction, summarization, search, Q&A
- **Architecture**: S3 + Textract + Lambda + OpenSearch + Bedrock

### 4. Code Assistant
- **Models**: Claude Sonnet
- **Features**: Code generation, review, documentation, bug fixing
- **Architecture**: API + Lambda + CodeCommit/GitHub integration

### 5. Data Analysis & Insights
- **Models**: Claude for analysis
- **Features**: Natural language to SQL, report generation, visualization descriptions
- **Architecture**: Lambda + Athena/RDS + Bedrock + QuickSight

### 6. Email/Content Moderation
- **Models**: Claude Haiku (fast + cheap)
- **Features**: Classification, toxic content detection, compliance checking
- **Architecture**: SES/EventBridge → Lambda → Bedrock → filtering logic

---

## Best Practices

### 1. Model Selection
- **Claude Haiku**: Fast, cheap tasks (classification, simple Q&A)
- **Claude Sonnet**: Balanced (most use cases, coding, analysis)
- **Claude Opus**: Complex reasoning, long documents, critical accuracy
- **Titan Embeddings**: Text vectorization for search/RAG
- **Stable Diffusion**: Image generation

### 2. Cost Optimization
- **Cache results**: Store common responses in DynamoDB
- **Use appropriate models**: Don't use Opus when Haiku suffices
- **Batch processing**: Group requests when possible
- **Set max_tokens**: Limit response length
- **Async for non-urgent**: Use SQS + async Lambda

### 3. Performance
- **Provisioned concurrency**: For consistent latency
- **Streaming**: Better UX for long responses
- **Regional deployment**: Bedrock is regional - deploy close to users
- **Lambda memory**: More memory = faster execution (test 512MB-3GB)

### 4. Security
- **IAM least privilege**: Grant only `bedrock:InvokeModel` for specific models
- **API authentication**: Use Cognito or API keys
- **Sensitive data**: Filter before sending to Bedrock
- **Audit logs**: Enable CloudTrail for Bedrock API calls
- **VPC Lambda**: For accessing private resources

### 5. Prompt Engineering
- **Be specific**: Clear instructions = better results
- **Use examples**: Few-shot learning improves accuracy
- **System prompts**: Set behavior and constraints
- **Structured output**: Ask for JSON for parsing
- **Error handling**: Handle model refusals gracefully

### 6. Monitoring
- **CloudWatch Metrics**: Track invocation count, latency, errors
- **X-Ray**: Trace request flows
- **Custom metrics**: Track cost, token usage, user satisfaction
- **Alarms**: Set up alerts for errors, throttling

---

## CDK Stack Examples

### Minimal Chat API
```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';

export class BedrockChatStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const chatLambda = new lambda.Function(this, 'ChatFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512
    });

    chatLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-*']
    }));

    new apigateway.LambdaRestApi(this, 'ChatAPI', {
      handler: chatLambda,
      proxy: true
    });
  }
}
```

### RAG with OpenSearch
```typescript
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

export class BedrockRAGStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Document storage
    const docBucket = new s3.Bucket(this, 'DocumentBucket');

    // Vector database
    const vectorDB = new opensearch.Domain(this, 'VectorDB', {
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      capacity: {
        dataNodes: 2,
        dataNodeInstanceType: 't3.small.search'
      }
    });

    // Embedding Lambda
    const embeddingLambda = new lambda.Function(this, 'EmbeddingFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'embedding.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        OPENSEARCH_ENDPOINT: vectorDB.domainEndpoint
      }
    });

    embeddingLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/amazon.titan-embed-*']
    }));

    docBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(embeddingLambda)
    );

    vectorDB.grantReadWrite(embeddingLambda);

    // Query Lambda
    const queryLambda = new lambda.Function(this, 'QueryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'query.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        OPENSEARCH_ENDPOINT: vectorDB.domainEndpoint
      }
    });

    queryLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/*']
    }));

    vectorDB.grantRead(queryLambda);

    new apigateway.LambdaRestApi(this, 'QueryAPI', {
      handler: queryLambda
    });
  }
}
```

---

## Quick Start Guide

### 1. Enable Bedrock Models
Before using any model, enable it in the AWS Console:
1. Go to AWS Bedrock console
2. Navigate to "Model access"
3. Click "Manage model access"
4. Select models you need (Claude, Titan, etc.)
5. Submit request (instant for most models)

### 2. Install Dependencies
```bash
npm install @aws-sdk/client-bedrock-runtime
npm install @aws-sdk/client-dynamodb
npm install @aws-sdk/client-s3
```

### 3. Set Up IAM Permissions
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "bedrock:InvokeModel",
    "Resource": "arn:aws:bedrock:us-east-1::foundation-model/*"
  }]
}
```

### 4. Deploy Your First Stack
```bash
cd bedrock-stack-1
npm install
cdk deploy
```

---

## Additional Resources

### AWS Documentation
- [Bedrock User Guide](https://docs.aws.amazon.com/bedrock/)
- [Bedrock API Reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/)
- [CDK Bedrock Constructs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrock-readme.html)

### Model Documentation
- [Claude API Documentation](https://docs.anthropic.com/claude/reference)
- [Titan Models](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-models.html)
- [Stable Diffusion on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/stable-diffusion.html)

### Code Examples
- [AWS Bedrock Samples](https://github.com/aws-samples/amazon-bedrock-samples)
- [AWS CDK Examples](https://github.com/aws-samples/aws-cdk-examples)

---

## Pricing Considerations

### Model Pricing (approximate, us-east-1)
- **Claude Haiku**: ~$0.25 per 1M input tokens, ~$1.25 per 1M output tokens
- **Claude Sonnet**: ~$3 per 1M input tokens, ~$15 per 1M output tokens
- **Claude Opus**: ~$15 per 1M input tokens, ~$75 per 1M output tokens
- **Titan Embeddings**: ~$0.10 per 1M tokens
- **Stable Diffusion**: ~$0.018-0.036 per image

### Cost Optimization Tips
1. **Right-size model selection**: Use Haiku for simple tasks
2. **Implement caching**: DynamoDB for frequent requests
3. **Reduce context size**: Only send necessary information
4. **Batch when possible**: Group multiple requests
5. **Monitor usage**: Set up billing alarms

---

## Getting Started Checklist

- [ ] Enable Bedrock models in AWS Console
- [ ] Set up IAM permissions for Lambda
- [ ] Choose your use case pattern
- [ ] Install AWS SDK dependencies
- [ ] Write Lambda function with Bedrock client
- [ ] Create CDK stack (Lambda + API Gateway + IAM)
- [ ] Deploy with `cdk deploy`
- [ ] Test your API endpoint
- [ ] Set up CloudWatch monitoring
- [ ] Implement error handling and retries
- [ ] Add authentication (Cognito/API keys)
- [ ] Optimize costs with appropriate model selection

---

**Generated for the bedrock-stack-1 CDK project**
**Date**: December 2025
