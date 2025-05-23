#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ $# -eq 0 ]; then
    echo "Usage: $0 <base-api-url>"
    echo "Example: $0 https://abc123def.execute-api.us-east-1.amazonaws.com/dev"
    exit 1
fi

BASE_URL=$1
HEALTH_URL="${BASE_URL}/health"
PROTECTED_URL="${BASE_URL}/protected"

echo "🧪 Testing API Gateway Lambda Token Authorizer"
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Valid token on health endpoint
echo -e "${YELLOW}Test 1: Valid token 'allow' on /health${NC}"
response=$(curl -s -w "\nSTATUS:%{http_code}" -H "Authorization: Bearer allow" "$HEALTH_URL")
echo "Response: $response"
echo ""

# Test 2: Valid token on protected endpoint
echo -e "${YELLOW}Test 2: Valid token 'valid-token-123' on /protected${NC}"
response=$(curl -s -w "\nSTATUS:%{http_code}" -H "Authorization: Bearer valid-token-123" "$PROTECTED_URL")
echo "Response: $response"
echo ""

# Test 3: Invalid token
echo -e "${YELLOW}Test 3: Invalid token 'deny' on /health${NC}"
response=$(curl -s -w "\nSTATUS:%{http_code}" -H "Authorization: Bearer deny" "$HEALTH_URL")
echo "Response: $response"
echo ""

# Test 4: Unauthorized token
echo -e "${YELLOW}Test 4: Unauthorized token on /protected${NC}"
response=$(curl -s -w "\nSTATUS:%{http_code}" -H "Authorization: Bearer unauthorized" "$PROTECTED_URL")
echo "Response: $response"
echo ""

# Test 5: No authorization header
echo -e "${YELLOW}Test 5: No authorization header on /health${NC}"
response=$(curl -s -w "\nSTATUS:%{http_code}" "$HEALTH_URL")
echo "Response: $response"
echo ""

# Test 6: Custom valid token (length > 10 with dash)
echo -e "${YELLOW}Test 6: Custom valid token 'my-valid-token-12345' on /protected${NC}"
response=$(curl -s -w "\nSTATUS:%{http_code}" -H "Authorization: Bearer my-valid-token-12345" "$PROTECTED_URL")
echo "Response: $response"
echo ""

# Test 7: POST request to protected endpoint
echo -e "${YELLOW}Test 7: POST request with valid token to /protected${NC}"
response=$(curl -s -w "\nSTATUS:%{http_code}" -X POST -H "Authorization: Bearer allow" -H "Content-Type: application/json" -d '{"test": "data"}' "$PROTECTED_URL")
echo "Response: $response"
echo ""

echo -e "${GREEN}✅ Testing completed!${NC}" 