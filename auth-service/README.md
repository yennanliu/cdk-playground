# Authorization Service

This project implements a secure Authorization Service using AWS CDK with TypeScript. It includes:

1. Amazon Cognito User Pool for user management and JWT token issuance
2. Lambda Authorizer for API Gateway that validates JWTs and checks user permissions
3. Protected API Gateway endpoint
4. DynamoDB table for storing user permissions (RBAC)

## Architecture

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│            │     │            │     │            │     │            │
│   Client   │────▶│  Cognito   │────▶│    API     │────▶│  Lambda    │
│            │     │ User Pool  │     │  Gateway   │     │ Function   │
│            │     │            │     │            │     │            │
└────────────┘     └────────────┘     └────────────┘     └────────────┘
                         │                  │
                         │                  │
                         ▼                  ▼
                   ┌────────────┐    ┌────────────┐
                   │            │    │            │
                   │   Lambda   │    │ DynamoDB   │
                   │ Authorizer │───▶│ (Perms)    │
                   │            │    │            │
                   └────────────┘    └────────────┘
```

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 14.x or later
- AWS CDK v2 installed globally (`npm install -g aws-cdk`)

## Installation

1. Install dependencies:
   ```
   npm install
   ```

2. Bootstrap your AWS environment (if you haven't already):
   ```
   cdk bootstrap
   ```

3. Deploy the stack:
   ```
   cdk deploy
   ```

## Usage

After deployment, you'll see the following outputs:
- Cognito User Pool ID
- Cognito User Pool Client ID
- API Gateway URL
- DynamoDB Permissions Table name

### Creating a User

1. Create a user in the Cognito User Pool:
   ```
   aws cognito-idp sign-up \
     --client-id YOUR_USER_POOL_CLIENT_ID \
     --username user@example.com \
     --password YourPassword123! \
     --user-attributes Name=email,Value=user@example.com
   ```

2. Confirm the user (or use admin confirm):
   ```
   aws cognito-idp admin-confirm-sign-up \
     --user-pool-id YOUR_USER_POOL_ID \
     --username user@example.com
   ```

### Adding User Permissions

Add permissions to the DynamoDB table:

```
aws dynamodb put-item \
  --table-name YOUR_PERMISSIONS_TABLE_NAME \
  --item '{
    "userId": {"S": "USER_SUB_ID"},
    "resource": {"S": "/secure"},
    "methods": {"L": [{"S": "GET"}]},
    "role": {"S": "user"}
  }'
```

### Authenticating and Accessing the API

1. Get authentication tokens:
   ```
   aws cognito-idp initiate-auth \
     --client-id YOUR_USER_POOL_CLIENT_ID \
     --auth-flow USER_PASSWORD_AUTH \
     --auth-parameters USERNAME=user@example.com,PASSWORD=YourPassword123!
   ```

2. Use the access token to call the secure endpoint:
   ```
   curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" https://YOUR_API_GATEWAY_URL/secure
   ```

## Customization

- Modify the Lambda authorizer logic in `lambda/authorizer.js` to implement your specific authorization rules.
- Update the secure endpoint in `lambda/secure-endpoint.js` to implement your business logic.
- Adjust the permissions model in DynamoDB to match your application's requirements.

## Security Considerations

- In production, set `removalPolicy` to `RETAIN` for critical resources.
- Consider enabling MFA for the Cognito User Pool.
- Implement more sophisticated permission checks based on your application's needs.
- Use environment-specific configurations for different stages (dev, staging, prod).

## Clean Up

To avoid incurring charges, delete the stack when you're done:

```
cdk destroy
```


## Ref

- https://github.com/aws-samples/aws-cdk-examples/tree/main/typescript/api-gateway-lambda-token-authorizer