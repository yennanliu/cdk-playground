# Auth Service Testing Guide

This guide explains how to test your deployed AWS Auth Service Stack.

## Overview

Your Auth Service Stack includes:
- **Cognito User Pool** for user authentication
- **API Gateway** with a protected `/secure` endpoint
- **Lambda Authorizer** for JWT token validation
- **DynamoDB** for user permissions (RBAC)
- **Lambda Functions** for business logic

## Testing Scripts

### 1. Quick Test (`npm run test:quick`)

**Purpose**: Basic API connectivity and endpoint protection testing
**Duration**: ~10 seconds
**Requirements**: None (no AWS credentials needed for basic tests)

```bash
npm run test:quick
```

**What it tests**:
- ✅ API Gateway connectivity
- ✅ Secure endpoint is properly protected (returns 401/403)
- ✅ Invalid endpoints return 404
- ✅ CORS headers are configured

### 2. Comprehensive Test (`npm run test`)

**Purpose**: Full authentication flow and RBAC testing
**Duration**: ~30-60 seconds
**Requirements**: AWS credentials with appropriate permissions

```bash
npm run test
```

**What it tests**:
- ✅ User registration in Cognito
- ✅ Password setting and user activation
- ✅ User login and JWT token generation
- ✅ Unauthorized access denial
- ✅ User permissions in DynamoDB
- ✅ Authorized access with valid tokens
- ✅ Invalid token rejection
- ✅ Cleanup (removes test user)

## Prerequisites

### For Quick Tests
- Node.js installed
- `npm install` completed

### For Comprehensive Tests
- AWS CLI configured with credentials
- Permissions for:
  - Cognito User Pool operations
  - DynamoDB read/write operations
  - API Gateway invoke permissions

### AWS Credentials Setup

```bash
# Option 1: AWS CLI
aws configure

# Option 2: Environment variables
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=ap-northeast-1

# Option 3: AWS Profile
export AWS_PROFILE=your_profile_name
```

## Configuration

The test scripts use the following deployed resources:

```javascript
const CONFIG = {
  USER_POOL_ID: 'ap-northeast-1_OCH9tU0eG',
  CLIENT_ID: '6u3elr9kuagfa8u6b2356supkp',
  API_BASE_URL: 'https://sa2ud0jra3.execute-api.ap-northeast-1.amazonaws.com/prod',
  PERMISSIONS_TABLE: 'AuthServiceStack-UserPermissionsTableD94A895D-3BH8KVOT7XUY',
  REGION: 'ap-northeast-1'
};
```

## Expected Results

### Quick Test Success
```
🚀 Quick API Test for Auth Service
==================================================
✅ Root Endpoint
✅ Secure Endpoint (Unauthorized)
✅ Invalid Endpoint
✅ CORS Headers
--------------------------------------------------
Result: 4/4 tests passed
🎉 All quick tests passed! Your API Gateway is working correctly.
```

### Comprehensive Test Success
```
🚀 Starting Auth Service Testing...
📝 Test 1: User Registration
✅ User created successfully

🔑 Test 2: Set Permanent Password
✅ Password set successfully

🔐 Test 3: User Login
✅ Login successful

🚫 Test 4: Unauthorized Access (should fail)
✅ Access correctly denied

🔐 Test 6: Add User Permissions
✅ User permissions added successfully

✅ Test 5: Authorized Access (should succeed)
✅ Access granted successfully

🚫 Test 7: Invalid Token Access (should fail)
✅ Invalid token correctly rejected

📊 Test Summary:
   Passed: 7/7
   Status: ✅ All tests passed!

🧹 Cleanup: Removing test user
✅ Test user removed successfully
```

## Troubleshooting

### Common Issues

1. **AWS Credentials Error**
   ```
   Error: Missing credentials in config
   ```
   **Solution**: Configure AWS credentials (see Prerequisites)

2. **Permission Denied**
   ```
   Error: User: arn:aws:iam::xxx:user/xxx is not authorized
   ```
   **Solution**: Ensure your AWS user has the required permissions

3. **Network Timeout**
   ```
   Error: timeout of 10000ms exceeded
   ```
   **Solution**: Check your internet connection and API Gateway URL

4. **Lambda Cold Start**
   ```
   Error: Task timed out after X seconds
   ```
   **Solution**: Run the test again; Lambda functions may be cold starting

### Debug Mode

For detailed logging, you can modify the test scripts to include more verbose output:

```javascript
// Add this at the top of test files for debugging
process.env.DEBUG = 'true';
```

## Manual Testing

You can also test manually using curl:

### Test Unauthorized Access
```bash
curl -v https://sa2ud0jra3.execute-api.ap-northeast-1.amazonaws.com/prod/secure
# Expected: 401 Unauthorized
```

### Test with Token (after getting token from Cognito)
```bash
curl -v \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://sa2ud0jra3.execute-api.ap-northeast-1.amazonaws.com/prod/secure
# Expected: 200 OK with user info
```

## Monitoring

### CloudWatch Logs
- Lambda Authorizer logs: `/aws/lambda/AuthServiceStack-AuthorizerFunction`
- Secure Endpoint logs: `/aws/lambda/AuthServiceStack-SecureEndpointFunction`
- API Gateway logs: Check API Gateway console

### DynamoDB
- Table: `AuthServiceStack-UserPermissionsTableD94A895D-3BH8KVOT7XUY`
- Check for user permissions entries

### Cognito
- User Pool: `ap-northeast-1_OCH9tU0eG`
- Check for test users (should be cleaned up automatically)

## Security Notes

⚠️ **Important**: The test scripts create temporary users for testing purposes. These users are automatically cleaned up, but you should monitor your Cognito User Pool to ensure no test users remain.

🔐 **Permissions**: The comprehensive test requires administrative permissions. In production, consider using a dedicated test environment with limited scope.

## Next Steps

After successful testing, you can:
1. Integrate the auth service with your frontend application
2. Add more endpoints and business logic
3. Implement more sophisticated RBAC rules
4. Set up monitoring and alerting
5. Configure production-ready security settings 