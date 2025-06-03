# API Testing Commands

API Endpoint: `https://3komsa3dge.execute-api.ap-northeast-1.amazonaws.com/prod/`
Website URL: `http://authorizerstack-websitebucket75c24d94-gpmjwze5lthi.s3-website-ap-northeast-1.amazonaws.com`

## Test Commands

### 1. Create Admin User
```bash
curl -X POST https://3komsa3dge.execute-api.ap-northeast-1.amazonaws.com/prod/members \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "Admin123!",
    "role": "admin"
  }'
```

### 2. Login as Admin
```bash
curl -X POST https://3komsa3dge.execute-api.ap-northeast-1.amazonaws.com/prod/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "Admin123!"
  }'
```

After getting the token from the login response, save it to use in subsequent requests:
```bash
export TOKEN="your-jwt-token-here"
```

### 3. Verify Token
```bash
curl -X POST https://3komsa3dge.execute-api.ap-northeast-1.amazonaws.com/prod/auth/verify \
  -H "Authorization: Bearer $TOKEN"
```

### 4. List All Members (Admin Only)
```bash
curl -X GET https://3komsa3dge.execute-api.ap-northeast-1.amazonaws.com/prod/members \
  -H "Authorization: Bearer $TOKEN"
```

### 5. Add New Regular User (Admin Only)
```bash
curl -X POST https://3komsa3dge.execute-api.ap-northeast-1.amazonaws.com/prod/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "User123!",
    "role": "user"
  }'
```

### 6. Delete Member (Admin Only)
```bash
curl -X DELETE https://3komsa3dge.execute-api.ap-northeast-1.amazonaws.com/prod/members/user@example.com \
  -H "Authorization: Bearer $TOKEN"
```

## Testing Flow

1. First create the admin user using command #1
2. Login as admin using command #2
3. Copy the JWT token from the login response and export it:
   ```bash
   export TOKEN="your-jwt-token-here"
   ```
4. Use the other commands with the token to test the functionality

## Expected Responses

- Success responses will have status codes 200 or 201
- Error responses will include appropriate status codes:
  - 401: Unauthorized (invalid credentials)
  - 403: Forbidden (insufficient permissions)
  - 404: Not Found
  - 500: Internal Server Error
