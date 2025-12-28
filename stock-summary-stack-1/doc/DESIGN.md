# Stock News Summarization Service - Design Document

## Overview

An AWS serverless service that collects recent news about US stocks and provides AI-generated summaries. The system accepts a stock ticker symbol (e.g., TSLA), scrapes news from public sources, and returns a concise bullet-point summary powered by AWS Bedrock. No external news APIs required.

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
┌──────────────────────────────────────────────────┐
│   Lambda Function                                │
│   ┌──────────────────────────────────────────┐   │
│   │ 1. Scrape news from public sources      │   │
│   │    (Google News, Yahoo Finance)         │   │
│   │ 2. Send raw HTML/text to Bedrock        │   │
│   │ 3. Bedrock extracts & summarizes news   │   │
│   │ 4. Format as JSON response              │   │
│   └──────────────────────────────────────────┘   │
└──────┬───────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│      AWS Bedrock             │
│  (Claude 3.5 Sonnet)         │
│                              │
│  • Extract news from HTML    │
│  • Summarize key points      │
│  • Analyze sentiment         │
└──────────────────────────────┘
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

**Purpose**: Scrape news and orchestrate AI summarization

**Runtime**: Node.js 20.x (or Python 3.12)

**Workflow**:
1. Validate input ticker symbol
2. Scrape news from public sources (Google News, Yahoo Finance)
   - Construct search URL: `https://www.google.com/search?q={ticker}+stock+news&tbm=nws`
   - Fetch HTML content using HTTP client
3. Send raw HTML/text to AWS Bedrock
4. Bedrock (Claude) extracts news headlines, dates, and content
5. Bedrock generates bullet-point summary with sentiment analysis
6. Parse AI response and format as JSON
7. Return response to API Gateway

**Environment Variables**:
- `BEDROCK_MODEL_ID`: Model identifier (e.g., `anthropic.claude-3-5-sonnet-20241022-v2:0`)
- `USER_AGENT`: User agent string for web scraping (default: generic browser UA)

**Dependencies**:
- `axios` or `node-fetch`: HTTP client for web scraping
- `@aws-sdk/client-bedrock-runtime`: Bedrock API client

**IAM Permissions Required**:
- `bedrock:InvokeModel` - To call Bedrock API
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` - CloudWatch logging

**Timeout**: 60 seconds (web scraping + AI processing)

**Memory**: 512 MB

**Notes**:
- Lambda must have internet access (via NAT Gateway if in VPC, or use default Lambda internet access)
- Web scraping may be rate-limited by target sites; implement retry logic with exponential backoff

### 3. AWS Bedrock

**Purpose**: AI-powered news extraction, analysis, and summarization

**Model**: Claude 3.5 Sonnet (recommended)
- High-quality HTML parsing and content extraction
- Strong reasoning capabilities
- JSON output support
- Excellent at understanding web content

**Prompt Strategy**:
```
You are a financial news analyst. You will receive HTML content from a web search
for "{TICKER} stock news". Your task is to:

1. Extract recent news headlines and content from the HTML
2. Identify the most important and relevant news items
3. Summarize them as concise bullet points
4. Analyze the overall sentiment

Focus on:
- Major company announcements
- Financial performance and earnings
- Product launches or changes
- Market-moving events
- Regulatory or legal developments
- Recent developments (past 7 days preferred)

HTML Content:
{html_content}

Return your response as a JSON object with this structure:
{
  "summary": ["bullet point 1", "bullet point 2", ...],
  "sentiment": "positive|neutral|negative",
  "sources": ["url1", "url2", ...]
}

If no relevant news is found, return an empty summary array.
```

**Token Considerations**:
- HTML can be large; may need to truncate to ~100K characters
- Claude 3.5 Sonnet has 200K context window
- Typical response: 1-2K output tokens

## News Sources

**Primary Sources** (scraped directly):
- **Google News**: `https://www.google.com/search?q={ticker}+stock+news&tbm=nws`
- **Yahoo Finance**: `https://finance.yahoo.com/quote/{ticker}/news`
- **MarketWatch**: `https://www.marketwatch.com/search?q={ticker}`

**Advantages**:
- No API keys required
- No rate limits from external APIs
- Free to use
- Real-time news availability

**Considerations**:
- HTML structure may change (requires maintenance)
- Respect robots.txt and site terms of service
- Implement user-agent rotation if needed
- Claude is excellent at adapting to different HTML structures

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

### 3. Rate Limiting

- API Gateway usage plans
- Throttling: 10 requests/second
- Quota: 1000 requests/day per API key

## Cost Estimation (Monthly)

**Assumptions**: 10,000 requests/month

| Service | Usage | Cost |
|---------|-------|------|
| API Gateway | 10,000 requests | $0.035 |
| Lambda | 10,000 invocations × 5s × 512MB | $0.17 |
| Bedrock | 10,000 requests × ~15K tokens input + 2K output | $45.00 |
| DynamoDB (optional) | 10,000 reads + writes | $0.25 |
| Data Transfer | Outbound traffic (negligible) | $0.01 |
| **Total** | | **~$45.50** |

**Notes**:
- Primary cost is Bedrock (Claude 3.5 Sonnet: $3/M input tokens, $15/M output tokens)
- HTML content increases token usage compared to structured API responses
- Caching with DynamoDB can reduce Bedrock costs significantly
- No external API costs

## Security Considerations

1. **API Authentication**: Use API keys or AWS IAM authentication
2. **Input Validation**: Sanitize ticker symbols to prevent injection attacks
3. **Rate Limiting**: Prevent abuse and control costs
4. **Web Scraping Ethics**:
   - Respect robots.txt
   - Implement reasonable delays between requests
   - Use appropriate User-Agent headers
5. **VPC (optional)**: Run Lambda in VPC for enhanced security
6. **Encryption**: Enable encryption at rest for DynamoDB (if used)
7. **XSS Prevention**: Sanitize HTML content before processing to prevent malicious scripts

## Deployment Strategy

### Using AWS CDK

1. **Stack Definition**: TypeScript CDK stack
2. **Lambda Function**: Separate TypeScript file compiled to JavaScript
3. **Dependencies**: Layer for node_modules (axios, AWS SDK)
4. **Environment**: Separate stacks for dev/prod

### CDK Stack Components

```typescript
- LambdaFunction (Node.js 20.x with axios/node-fetch)
- RestApi (API Gateway)
- BedrockPolicy (IAM permissions for InvokeModel)
- DynamoDBTable (optional - for caching)
- CloudWatch Logs & Alarms
```

## Development Workflow

1. **Local Development**: Test Lambda function locally with sample data
2. **Unit Tests**: Jest tests for Lambda logic
3. **Deploy**: `cdk deploy`
4. **Test**: Use Postman/curl to test API endpoint
5. **Monitor**: Check CloudWatch logs and metrics
6. **Iterate**: Update code and redeploy

## Future Enhancements

1. **Multi-source aggregation**: Scrape and combine news from Google News + Yahoo Finance + MarketWatch
2. **Historical analysis**: Store summaries in DynamoDB and track changes over time
3. **Sentiment tracking**: Track sentiment trends and generate alerts on sentiment shifts
4. **Email alerts**: Send daily summaries for watchlist stocks via SNS/SES
5. **WebSocket support**: Real-time news updates via API Gateway WebSocket
6. **Batch processing**: Process multiple tickers in one request
7. **Internationalization**: Support international stock exchanges (LSE, TSE, etc.)
8. **Smart caching**: Cache by ticker+date in DynamoDB with 1-hour TTL
9. **Structured extraction**: Extract specific fields (price targets, analyst ratings)
10. **Fallback sources**: If Google News fails, automatically try Yahoo Finance

## References

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Claude 3.5 Sonnet Model](https://www.anthropic.com/claude/sonnet)
- [AWS CDK TypeScript Reference](https://docs.aws.amazon.com/cdk/api/v2/)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Axios HTTP Client](https://axios-http.com/)
- [Web Scraping Best Practices](https://www.scrapehero.com/web-scraping-best-practices/)
- [robots.txt Parser](https://www.npmjs.com/package/robots-parser)
