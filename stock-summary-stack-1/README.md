# Stock News Summary Service

An AWS serverless service that collects recent news about US stocks and provides AI-generated summaries powered by AWS Bedrock (Claude 3.5 Sonnet).

## Architecture

- **Lambda Function**: Scrapes news from public sources (Google News) and processes with Bedrock
- **API Gateway**: REST API with `/summarize` POST endpoint
- **AWS Bedrock**: Claude 3.5 Sonnet for news extraction and summarization
- **No external APIs**: No news API keys required

See [design documentation](./doc/DESIGN.md) for detailed architecture.

## Prerequisites

1. AWS CLI configured with credentials
2. AWS CDK CLI installed: `npm install -g aws-cdk`
3. Node.js 20.x or later
4. AWS Bedrock access to Claude 3.5 Sonnet model in your region

## Installation

```bash
npm install
```

## Deployment

```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Synthesize CloudFormation template
cdk synth

# Deploy to AWS
cdk deploy
```

After deployment, note the `SummarizeEndpoint` output - this is your API endpoint.

## Usage

### Using the Bash Script (Recommended)

```bash
# Make script executable (first time only)
chmod +x get_stock_news_summary.sh

# Get news summary for any stock
./get_stock_news_summary.sh TSLA
./get_stock_news_summary.sh AAPL
./get_stock_news_summary.sh NVDA

# Also works with lowercase
./get_stock_news_summary.sh msft
```

### Direct API Request

```bash
curl -X POST https://<your-api-id>.execute-api.<region>.amazonaws.com/prod/summarize \
  -H "Content-Type: application/json" \
  -d '{"ticker": "TSLA"}'
```

### Response Format

```json
{
  "ticker": "TSLA",
  "summary": [
    "Tesla announces new Gigafactory in Texas",
    "Q4 earnings beat expectations by 15%",
    "Cybertruck production ramps up"
  ],
  "sentiment": "positive",
  "sources": ["url1", "url2", "url3"],
  "timestamp": "2025-12-28T10:30:00Z"
}
```

## Development Commands

* `npm run build` - Compile TypeScript to JavaScript
* `npm run watch` - Watch for changes and compile
* `npm run test` - Run Jest unit tests
* `cdk deploy` - Deploy to AWS
* `cdk diff` - Show changes to be deployed
* `cdk synth` - Generate CloudFormation template
* `cdk destroy` - Remove all resources from AWS

## Project Structure

```
.
├── bin/                    # CDK app entry point
├── lib/                    # CDK stack definition
├── lambda/                 # Lambda function code
├── doc/                    # Design documentation
├── test/                   # Unit tests
└── package.json            # Dependencies
```

## Cost Estimation

Approximately $45/month for 10,000 requests (primarily Bedrock costs). See [design doc](./doc/DESIGN.md) for details.

## License

MIT
