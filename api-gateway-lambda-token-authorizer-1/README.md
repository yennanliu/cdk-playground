# AWS CDK Token-Based Authentication with Lambda + API Gateway

This project implements a simple token-based authentication system using AWS Lambda and API Gateway with AWS CDK in TypeScript.

## Architecture

The implementation includes:

- **Token Authorizer Lambda**: Validates authorization tokens and returns IAM policies
- **API Gateway REST API**: Routes requests and enforces authorization
- **Protected Lambda Functions**: Business logic that requires authentication
- **Public Endpoints**: Accessible without authentication

## Features

- Simple token-based authentication (TOKEN authorizer type)
- Multiple endpoints (public and protected)
- CORS enabled for web applications
- Comprehensive error handling
- CloudFormation outputs for easy testing

## Token Validation Logic

The authorizer accepts these token values in the `Authorization` header:

- `allow` → Returns Allow policy (200 OK)
- `deny` → Returns Deny policy (403 Forbidden)
- `unauthorized` → Throws error (401 Unauthorized)
- Any other value → Throws error (500 Internal Server Error)

## API Endpoints

### Public Endpoints
- `GET /public` - No authentication required

### Protected Endpoints (require Authorization header)
- `GET /protected` - Returns protected resource data
- `GET /users` - Returns user list

## Deployment

### Prerequisites
- AWS CLI configured with appropriate credentials
- Node.js and npm installed
- AWS CDK CLI installed (`npm install -g aws-cdk`)

### Deploy the Stack

```bash
# Install dependencies
npm install

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy the stack
cdk deploy
```

The deployment will output the API Gateway URL for testing.

## Testing

### Test Public Endpoint (No Auth Required)

```bash
# Replace <API_URL> with the actual URL from CDK output
curl -X GET "<API_URL>/public"
```

Expected response:
```json
{
  "message": "Hello from public endpoint! No authorization required."
}
```

### Test Protected Endpoints

#### Valid Token (allow)
```bash
curl -X GET "<API_URL>/protected" \
  -H "Authorization: allow"
```

Expected response:
```json
{
  "message": "Hello from protected resource!",
  "user": "user",
  "context": {
    "principalId": "user",
    "stringKey": "stringval",
    "numberKey": 123,
    "booleanKey": true
  }
}
```

#### Invalid Token (deny)
```bash
curl -X GET "<API_URL>/protected" \
  -H "Authorization: deny"
```

Expected response: `403 Forbidden`

#### Unauthorized Token
```bash
curl -X GET "<API_URL>/protected" \
  -H "Authorization: unauthorized"
```

Expected response: `401 Unauthorized`

#### Invalid Token
```bash
curl -X GET "<API_URL>/protected" \
  -H "Authorization: invalid-token"
```

Expected response: `500 Internal Server Error`

#### No Authorization Header
```bash
curl -X GET "<API_URL>/protected"
```

Expected response: `401 Unauthorized`

### Test Users Endpoint

```bash
curl -X GET "<API_URL>/users" \
  -H "Authorization: allow"
```

Expected response:
```json
{
  "message": "Users endpoint accessed successfully!",
  "users": [
    { "id": 1, "name": "John Doe" },
    { "id": 2, "name": "Jane Smith" }
  ],
  "authorizedUser": "user"
}
```

## Customization

### Extending Token Validation

To implement more sophisticated token validation (e.g., JWT tokens), modify the authorizer Lambda function in the stack:

```typescript
// Example: JWT token validation
const authorizerLambda = new lambda.Function(this, 'TokenAuthorizerLambda', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/authorizer'), // External file
  environment: {
    JWT_SECRET: 'your-jwt-secret'
  }
});
```

### Adding More Endpoints

Add new protected endpoints by creating additional resources:

```typescript
const newResource = api.root.addResource('new-endpoint');
newResource.addMethod('GET', new apigateway.LambdaIntegration(newLambda), {
  authorizer: tokenAuthorizer,
  authorizationType: apigateway.AuthorizationType.CUSTOM
});
```

## Security Considerations

⚠️ **Important**: This is a simplified example for demonstration purposes. For production use:

1. Use proper JWT tokens with cryptographic signatures
2. Implement token expiration and refresh mechanisms
3. Use AWS Secrets Manager for storing secrets
4. Enable API Gateway logging and monitoring
5. Implement rate limiting and throttling
6. Use HTTPS only in production

## Clean Up

To avoid AWS charges, destroy the stack when done:

```bash
cdk destroy
```

## Useful CDK Commands

- `npm run build` - Compile TypeScript to JS
- `npm run watch` - Watch for changes and compile
- `npm run test` - Perform Jest unit tests
- `cdk deploy` - Deploy this stack to your default AWS account/region
- `cdk diff` - Compare deployed stack with current state
- `cdk synth` - Emits the synthesized CloudFormation template
- `cdk destroy` - Destroys this stack from your default AWS account/region

## Reference

Based on the AWS CDK examples:
- https://github.com/aws-samples/aws-cdk-examples/tree/main/typescript/api-gateway-lambda-token-authorizer

## License

This project is licensed under the MIT License.