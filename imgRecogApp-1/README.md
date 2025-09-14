# Image Recognition App - Serverless System Design

## Architecture Overview

**Frontend → API Gateway → Lambda → Rekognition**

## Run

```bash
npm install

cdk bootstrap

cdk deploy --all

# clean compiled JS, TS files
npm run clean
```

## API Endpoints

Base URL: `https://your-api-id.execute-api.region.amazonaws.com/prod/`

### GET /
- **Description**: Get API information and available endpoints
- **Response**: JSON with API overview and endpoint descriptions

### POST /upload-url
- **Description**: Generate presigned S3 URL for image upload
- **Request Body**:
  ```json
  {
    "fileName": "image.jpg",
    "fileType": "image/jpeg"
  }
  ```
- **Response**:
  ```json
  {
    "uploadUrl": "https://s3-presigned-url...",
    "imageId": "1234567890",
    "key": "images/1234567890-image.jpg"
  }
  ```

### POST /process-image
- **Description**: Process uploaded image with Amazon Rekognition
- **Request Body**:
  ```json
  {
    "imageId": "1234567890",
    "key": "images/1234567890-image.jpg"
  }
  ```
- **Response**:
  ```json
  {
    "imageId": "1234567890",
    "labels": [
      {
        "Name": "Person",
        "Confidence": 95.5
      }
    ]
  }
  ```

### GET /results/{imageId}
- **Description**: Get recognition results for a specific image
- **Response**:
  ```json
  {
    "imageId": "1234567890",
    "userId": "anonymous",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "key": "images/1234567890-image.jpg",
    "labels": [...],
    "processedAt": "2024-01-01T00:00:00.000Z"
  }
  ```

## Web Interface

Open `web/index.html` in your browser to use the simple web interface for uploading and analyzing images.

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
