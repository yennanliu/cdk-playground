# Deployment Guide

## Ref
- https://github.com/aws-samples/aws-cdk-examples/tree/main/typescript/api-gateway-lambda-token-authorizer

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Bootstrap CDK** (first time only):
   ```bash
   cdk bootstrap
   ```

3. **Deploy the stack**:
   ```bash
   cdk deploy
   ```

4. **Get the API URL** from the output and test:
   ```bash
   # Copy the API URL from the deployment output
   ./test-api.sh <YOUR_API_URL>
   ```

## Manual Testing Examples

Replace `<API_URL>` with your actual API Gateway URL:

### Public Endpoint (No Auth)
```bash
curl -X GET "<API_URL>/public"
```

### Protected Endpoints

#### Valid Token
```bash
curl -X GET "<API_URL>/protected" -H "Authorization: allow"
curl -X GET "<API_URL>/users" -H "Authorization: allow"
```

#### Invalid Token (Forbidden)
```bash
curl -X GET "<API_URL>/protected" -H "Authorization: deny"
```

#### Unauthorized Token
```bash
curl -X GET "<API_URL>/protected" -H "Authorization: unauthorized"
```

#### No Authorization Header
```bash
curl -X GET "<API_URL>/protected"
```

## Clean Up

```bash
cdk destroy
```

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client        │───▶│  API Gateway     │───▶│ Lambda Function │
│                 │    │                  │    │ (Business Logic)│
└─────────────────┘    │  ┌─────────────┐ │    └─────────────────┘
                       │  │ Token       │ │
                       │  │ Authorizer  │ │
                       │  │ (Lambda)    │ │
                       │  └─────────────┘ │
                       └──────────────────┘
```

## Token Validation Flow

1. Client sends request with `Authorization` header
2. API Gateway extracts token and calls Token Authorizer Lambda
3. Authorizer Lambda validates token and returns IAM policy
4. If policy allows, API Gateway forwards request to business logic Lambda
5. Business logic Lambda processes request and returns response

## Extending for Production

For production use, consider:

1. **JWT Tokens**: Replace simple string validation with proper JWT verification
2. **Secrets Management**: Use AWS Secrets Manager for storing secrets
3. **Caching**: Enable authorizer result caching for better performance
4. **Monitoring**: Add CloudWatch logs and metrics
5. **Rate Limiting**: Implement API Gateway throttling
6. **HTTPS Only**: Ensure all traffic uses HTTPS
7. **Input Validation**: Add request validation at API Gateway level 