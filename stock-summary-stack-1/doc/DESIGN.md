# Stock News Summarization Service - Design Document

## Overview

An AWS serverless service that collects recent news about US stocks and provides AI-generated summaries. The system accepts a stock ticker symbol (e.g., TSLA), fetches relevant news articles, and returns a concise bullet-point summary powered by AWS Bedrock.

## Architecture Diagram

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ POST /summarize { "ticker": "TSLA" }
       ▼
┌─────────────────────┐
│   API Gateway       │
│   (REST API)        │
└──────┬──────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│   Lambda Function                    │
│   ┌──────────────────────────────┐   │
│   │ 1. Fetch news from News API  │   │
│   │ 2. Call Bedrock to summarize │   │
│   │ 3. Format as JSON response   │   │
│   └──────────────────────────────┘   │
└──────┬───────────────────┬───────────┘
       │                   │
       ▼                   ▼
┌─────────────┐    ┌─────────────────┐
│  News API   │    │  AWS Bedrock    │
│  (External) │    │  (Claude/Titan) │
└─────────────┘    └─────────────────┘
```

## Components

### 1. API Gateway (REST API)

**Purpose**: HTTP endpoint for client requests

**Configuration**:
- Endpoint: `POST /summarize`
- Request format: JSON
- Response format: JSON
- Integrates with Lambda via proxy integration

**Request Schema**:
```json
{
  "ticker": "TSLA"
}
```

**Features**:
- CORS enabled for web clients
- Request validation
- Rate limiting (optional)
- API key authentication (optional)

### 2. Lambda Function

**Purpose**: Orchestrate news fetching and summarization

**Runtime**: Node.js 20.x (or Python 3.12)

**Workflow**:
1. Validate input ticker symbol
2. Fetch recent news articles from external news API
3. Filter and prepare articles for summarization
4. Invoke AWS Bedrock with structured prompt
5. Parse AI response and format as JSON
6. Return response to API Gateway

**Environment Variables**:
- `NEWS_API_KEY`: API key for news service
- `BEDROCK_MODEL_ID`: Model identifier (e.g., `anthropic.claude-3-5-sonnet-20241022-v2:0`)
- `MAX_ARTICLES`: Maximum number of articles to process (default: 10)

**IAM Permissions Required**:
- `bedrock:InvokeModel` - To call Bedrock API
- `secretsmanager:GetSecretValue` - To retrieve API keys (optional)
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` - CloudWatch logging

**Timeout**: 30 seconds (news fetching + AI processing)

**Memory**: 512 MB

### 3. AWS Bedrock

**Purpose**: AI-powered news analysis and summarization

**Model**: Claude 3.5 Sonnet (recommended)
- High-quality summarization
- Strong reasoning capabilities
- JSON output support

**Prompt Strategy**:
```
You are a financial news analyst. Given the following news articles about {TICKER},
extract and summarize the most important information as concise bullet points.

Focus on:
- Major company announcements
- Financial performance and earnings
- Product launches or changes
- Market-moving events
- Regulatory or legal developments

Articles:
{articles}

Return your response as a JSON object with this structure:
{
  "summary": ["bullet point 1", "bullet point 2", ...],
  "sentiment": "positive|neutral|negative"
}
```

### 4. External News API

**Options**:
- **NewsAPI.org** - Free tier: 100 requests/day
- **Finnhub.io** - Stock-specific news, free tier available
- **Alpha Vantage** - Financial data + news, free tier available

**Storage**: API key stored in AWS Secrets Manager or Parameter Store

## API Response Format

### Success Response (200 OK)

```json
{
  "ticker": "TSLA",
  "summary": [
    "Tesla announces new Gigafactory in Texas with $10B investment",
    "Q4 2025 earnings beat expectations by 15%, revenue up 23% YoY",
    "Cybertruck production ramps up to 1,000 units per week",
    "New battery technology promises 500-mile range by 2026",
    "CEO announces expansion into energy storage market"
  ],
  "sentiment": "positive",
  "sources": [
    "https://example.com/article1",
    "https://example.com/article2",
    "https://example.com/article3"
  ],
  "timestamp": "2025-12-28T10:30:00Z",
  "articleCount": 8
}
```

### Error Response (400 Bad Request)

```json
{
  "error": "Invalid ticker symbol",
  "message": "Ticker must be a valid US stock symbol (1-5 uppercase letters)"
}
```

### Error Response (500 Internal Server Error)

```json
{
  "error": "Service unavailable",
  "message": "Unable to fetch news or generate summary"
}
```

## Optional Enhancements

### 1. DynamoDB Caching Layer

**Purpose**: Reduce API calls and improve response time

**Table Schema**:
```
PK: ticker (e.g., "TSLA")
SK: date (e.g., "2025-12-28")
TTL: timestamp (expire after 24 hours)
Attributes: summary, sources, sentiment, timestamp
```

**Flow**:
1. Check DynamoDB for cached summary (same ticker + same day)
2. If cache hit and < 1 hour old, return cached data
3. If cache miss or stale, fetch fresh news and update cache

### 2. CloudWatch Monitoring

**Metrics**:
- Lambda invocation count
- Lambda duration
- API Gateway 4xx/5xx errors
- Bedrock invocation count and latency

**Alarms**:
- Error rate > 5%
- Lambda duration > 25 seconds
- Bedrock throttling errors

### 3. API Key Management

- Store News API key in AWS Secrets Manager
- Rotate keys automatically
- Use IAM role for Lambda to retrieve secrets

### 4. Rate Limiting

- API Gateway usage plans
- Throttling: 10 requests/second
- Quota: 1000 requests/day per API key

## Cost Estimation (Monthly)

**Assumptions**: 10,000 requests/month

| Service | Usage | Cost |
|---------|-------|------|
| API Gateway | 10,000 requests | $0.035 |
| Lambda | 10,000 invocations × 3s × 512MB | $0.10 |
| Bedrock | 10,000 requests × ~5K tokens | $15.00 |
| DynamoDB (optional) | 10,000 reads + writes | $0.25 |
| **Total** | | **~$15.35** |

**Note**: Primary cost is Bedrock. News API costs depend on chosen provider.

## Security Considerations

1. **API Authentication**: Use API keys or AWS IAM authentication
2. **Input Validation**: Sanitize ticker symbols to prevent injection
3. **Rate Limiting**: Prevent abuse and control costs
4. **Secrets Management**: Store API keys in Secrets Manager, not environment variables
5. **VPC (optional)**: Run Lambda in VPC for enhanced security
6. **Encryption**: Enable encryption at rest for DynamoDB (if used)

## Deployment Strategy

### Using AWS CDK

1. **Stack Definition**: TypeScript CDK stack
2. **Lambda Function**: Separate TypeScript file compiled to JavaScript
3. **Dependencies**: Layer for node_modules (axios, AWS SDK)
4. **Environment**: Separate stacks for dev/prod

### CDK Stack Components

```typescript
- LambdaFunction (Node.js 20.x)
- RestApi (API Gateway)
- BedrockPolicy (IAM)
- Secret (Secrets Manager - for News API key)
- DynamoDBTable (optional - for caching)
- CloudWatch Logs
```

## Development Workflow

1. **Local Development**: Test Lambda function locally with sample data
2. **Unit Tests**: Jest tests for Lambda logic
3. **Deploy**: `cdk deploy`
4. **Test**: Use Postman/curl to test API endpoint
5. **Monitor**: Check CloudWatch logs and metrics
6. **Iterate**: Update code and redeploy

## Future Enhancements

1. **Multi-source aggregation**: Combine news from multiple APIs
2. **Historical analysis**: Store and compare summaries over time
3. **Sentiment tracking**: Track sentiment trends
4. **Email alerts**: Send daily summaries for watchlist stocks
5. **WebSocket support**: Real-time news updates
6. **Batch processing**: Process multiple tickers in one request
7. **Internationalization**: Support international stock exchanges

## References

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [NewsAPI Documentation](https://newsapi.org/docs)
- [AWS CDK TypeScript Reference](https://docs.aws.amazon.com/cdk/api/v2/)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
