# LLM ChatBot System - TODO

## Prompt

Design a simple chatbot system using AWS CDK and an open-source LLM.
The system should allow users to send chat messages via a web interface, process the messages through an LLM backend, and return responses.
Keep the design minimal but functional:

## Requirements:
1. **Frontend**: Simple web UI hosted on S3 + CloudFront (or similar) for sending and displaying messages.
2. **API Layer**: Use API Gateway to handle HTTPS requests from the frontend.
3. **Compute Layer**:
   • Option A: ECS/Fargate running a containerized open-source LLM (e.g., GPT4All, MPT, LLaMA.cpp).
   • Option B: Lambda function calling a small Hugging Face model (CPU-only).
4. **LLM**: Open-source language model for text generation.
5. **Storage (Optional)**: DynamoDB to store chat history and user context.
6. **Networking**: VPC, subnets, and security groups for secure and isolated deployment.

## Design Goals:
• Minimal complexity and cost.
• Scalable: ECS/Fargate auto-scaling or serverless Lambda.
• Optional features: caching with ElastiCache, authentication with Cognito, and real-time messaging via WebSockets.

## Deliverables:
• A high-level architecture diagram.
• AWS CDK resource recommendations for each component.
• Data flow description from user input to LLM response.

## Recommended Design Approach

### Simplest Possible Architecture
For maximum simplicity and cost-effectiveness, I recommend **Option B: Lambda-based approach**:

```
[User] → [S3/CloudFront] → [API Gateway] → [Lambda] → [Amazon Bedrock] → [DynamoDB]
```

### High-Level Architecture

1. **Frontend**: Static React/HTML+JS hosted on S3 + CloudFront
2. **API**: API Gateway REST API with CORS enabled
3. **Compute**: Single Lambda function (Node.js/Python)
4. **LLM**: Amazon Bedrock (serverless, pay-per-use)
5. **Storage**: DynamoDB for chat history
6. **No VPC needed** - keeps it simple and reduces costs

### Tech Stack Recommendation

**Frontend:**
- Vanilla HTML/CSS/JS or simple React app
- Bootstrap/Tailwind for quick styling
- Fetch API for backend calls

**Backend:**
- AWS Lambda (Node.js 18+ or Python 3.9+)
- API Gateway REST API
- DynamoDB with single table design

**LLM Integration (AWS Native Options):**
- **Option 1**: Amazon Bedrock (Recommended)
- **Option 2**: Amazon SageMaker JumpStart
- **Option 3**: AWS Lambda with small local models

**CDK Components:**
```typescript
- aws-cdk-lib/aws-s3
- aws-cdk-lib/aws-cloudfront
- aws-cdk-lib/aws-apigateway
- aws-cdk-lib/aws-lambda
- aws-cdk-lib/aws-dynamodb
- aws-cdk-lib/aws-bedrock (for model access)
```

### AWS Native LLM Options

**Option 1: Amazon Bedrock (Recommended)**
- Serverless, pay-per-use
- Pre-trained models: Claude, Jurassic, Titan
- No infrastructure management
- Built-in safety features
- IAM-based access control

**Option 2: SageMaker JumpStart**
- Deploy pre-trained models to endpoints
- More control but requires endpoint management
- Higher costs (always-on endpoints)

**Option 3: Lambda + Small Models**
- Use lightweight models in Lambda layers
- Limited capability but fully contained
- Good for simple use cases

### Bedrock Integration Benefits
- **No API keys needed** - uses IAM roles
- **Enterprise ready** - built-in compliance
- **Cost effective** - pay only for usage
- **Multiple models** - Claude, Titan, etc.
- **Built-in safety** - content filtering

### Data Flow
1. User types message → Frontend
2. Frontend POST /chat → API Gateway
3. API Gateway → Lambda function
4. Lambda: Store message → DynamoDB
5. Lambda: Call Amazon Bedrock API
6. Lambda: Store response → DynamoDB
7. Lambda: Return response → Frontend
8. Frontend displays response

### Why This Approach?
- **Simplest**: No containers, no VPC, minimal services
- **Cheapest**: Serverless pay-per-use, free tier friendly
- **Fastest to build**: Fewer moving parts
- **Scalable**: Lambda auto-scales, DynamoDB on-demand

### Estimated Costs (low usage)
- S3/CloudFront: ~$1-5/month
- API Gateway: ~$3.50/million requests
- Lambda: Free tier covers most development
- DynamoDB: Free tier covers development
- Amazon Bedrock: Pay-per-token (~$0.0015/1K tokens)

## Implementation Tasks:
- [x] Design high-level architecture diagram
- [x] Provide AWS CDK resource recommendations for each component
- [x] Describe data flow from user input to LLM response
- [x] Choose compute layer: Amazon Bedrock + Lambda approach
- [ ] Update README.md with new architecture
- [ ] Implement frontend (S3 + CloudFront web UI)
- [ ] Implement API Gateway for HTTPS requests
- [ ] Implement Lambda function with Bedrock integration
- [ ] Add DynamoDB for chat history storage
- [ ] Test and deploy the complete system