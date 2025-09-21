# LLM ChatBot System

A simple serverless chatbot system built with AWS CDK, Amazon Bedrock, and AWS Lambda.

## Architecture

```
[User] → [S3/CloudFront] → [API Gateway] → [Lambda] → [Amazon Bedrock] → [DynamoDB]
```

### Components

- **Frontend**: Static web UI hosted on S3 + CloudFront
- **API**: REST API Gateway with CORS enabled
- **Compute**: AWS Lambda function (Node.js/Python)
- **LLM**: Amazon Bedrock (Claude 3 Haiku recommended)
- **Storage**: DynamoDB for chat history
- **CDK Stack**: Infrastructure as Code using AWS CDK

### Key Benefits

- **Serverless**: Pay-per-use, auto-scaling
- **AWS Native**: No external API dependencies
- **Cost Effective**: Free tier friendly for development
- **Secure**: IAM-based access control, no API keys needed
- **Simple**: Minimal infrastructure complexity

## Getting Started

### Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ installed
- AWS CDK CLI installed (`npm install -g aws-cdk`)

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Bootstrap CDK (first time only):
   ```bash
   cdk bootstrap
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Deploy the stack:
   ```bash
   cdk deploy
   ```

## Useful Commands

* `npm run build`   - Compile TypeScript to JS
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Run Jest unit tests
* `cdk deploy`      - Deploy stack to AWS
* `cdk diff`        - Compare deployed vs current state
* `cdk synth`       - Generate CloudFormation template
* `cdk destroy`     - Remove all resources

## Configuration

The system uses Amazon Bedrock for LLM functionality. Ensure you have:

1. **Bedrock Access**: Enable model access in AWS Bedrock console
2. **IAM Permissions**: Lambda execution role needs `bedrock:InvokeModel` permission
3. **Supported Models**: Claude 3 Haiku, Titan Text, or other Bedrock models

## Cost Estimation

For low usage (development/testing):
- S3/CloudFront: ~$1-5/month
- API Gateway: ~$3.50/million requests
- Lambda: Free tier covers most development
- DynamoDB: Free tier covers development
- Amazon Bedrock: ~$0.25/1M input tokens, ~$1.25/1M output tokens

## Development Roadmap

See [TODO.md](./TODO.md) for detailed implementation tasks and progress.
