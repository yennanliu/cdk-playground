# Image Recognition App - Serverless System Design

## Architecture Overview

**Frontend → API Gateway → Lambda → Rekognition**

## Core Components

### 1. **Storage Layer**
- **S3 Bucket**: Store uploaded images
- **DynamoDB**: Store recognition results and metadata

### 2. **Processing Layer**
- **Lambda Function**: Main handler for image processing
- **Amazon Rekognition**: AI service for image analysis

### 3. **API Layer**
- **API Gateway**: REST endpoints for upload/retrieve operations
- **CloudFront**: CDN for image delivery (optional)

## Simple Flow

1. **Upload**: Client uploads image to S3 via presigned URL
2. **Trigger**: S3 event triggers Lambda function
3. **Process**: Lambda calls Rekognition to analyze image
4. **Store**: Results saved to DynamoDB
5. **Retrieve**: Client queries API Gateway to get results

## Key Benefits
- **Serverless**: Pay per use, auto-scaling
- **Simple**: Minimal infrastructure management
- **Fast**: Built-in AI with Rekognition
- **Secure**: IAM roles and policies

## CDK Implementation Structure
```
lib/
├── storage-stack.ts    # S3 + DynamoDB
├── api-stack.ts       # API Gateway + Lambda
└── imgrecog-app.ts    # Main app stack
```

This design keeps things simple while leveraging AWS managed services for reliability and scalability.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
