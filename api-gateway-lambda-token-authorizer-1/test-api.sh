#!/bin/bash

# Test script for AWS CDK Token-Based Authentication API
# Usage: ./test-api.sh <API_URL>
# Example: ./test-api.sh https://abc123.execute-api.us-east-1.amazonaws.com/prod

if [ $# -eq 0 ]; then
    echo "Usage: $0 <API_URL>"
    echo "Example: $0 https://abc123.execute-api.us-east-1.amazonaws.com/prod"
    exit 1
fi

API_URL=$1

echo "🚀 Testing AWS CDK Token-Based Authentication API"
echo "API URL: $API_URL"
echo ""

# Test 1: Public endpoint (no auth required)
echo "📍 Test 1: Public endpoint (no authorization required)"
echo "GET $API_URL/public"
curl -s -X GET "$API_URL/public" | jq '.' || echo "Response not in JSON format"
echo ""
echo ""

# Test 2: Protected endpoint with valid token
echo "📍 Test 2: Protected endpoint with valid token (allow)"
echo "GET $API_URL/protected with Authorization: allow"
curl -s -X GET "$API_URL/protected" \
  -H "Authorization: allow" | jq '.' || echo "Response not in JSON format"
echo ""
echo ""

# Test 3: Protected endpoint with deny token
echo "📍 Test 3: Protected endpoint with deny token"
echo "GET $API_URL/protected with Authorization: deny"
echo "Expected: 403 Forbidden"
curl -s -w "HTTP Status: %{http_code}\n" -X GET "$API_URL/protected" \
  -H "Authorization: deny"
echo ""
echo ""

# Test 4: Protected endpoint with unauthorized token
echo "📍 Test 4: Protected endpoint with unauthorized token"
echo "GET $API_URL/protected with Authorization: unauthorized"
echo "Expected: 401 Unauthorized"
curl -s -w "HTTP Status: %{http_code}\n" -X GET "$API_URL/protected" \
  -H "Authorization: unauthorized"
echo ""
echo ""

# Test 5: Protected endpoint with invalid token
echo "📍 Test 5: Protected endpoint with invalid token"
echo "GET $API_URL/protected with Authorization: invalid-token"
echo "Expected: 500 Internal Server Error"
curl -s -w "HTTP Status: %{http_code}\n" -X GET "$API_URL/protected" \
  -H "Authorization: invalid-token"
echo ""
echo ""

# Test 6: Protected endpoint without authorization header
echo "📍 Test 6: Protected endpoint without authorization header"
echo "GET $API_URL/protected (no Authorization header)"
echo "Expected: 401 Unauthorized"
curl -s -w "HTTP Status: %{http_code}\n" -X GET "$API_URL/protected"
echo ""
echo ""

# Test 7: Users endpoint with valid token
echo "📍 Test 7: Users endpoint with valid token"
echo "GET $API_URL/users with Authorization: allow"
curl -s -X GET "$API_URL/users" \
  -H "Authorization: allow" | jq '.' || echo "Response not in JSON format"
echo ""
echo ""

# Test 8: Users endpoint with invalid token
echo "📍 Test 8: Users endpoint with invalid token"
echo "GET $API_URL/users with Authorization: deny"
echo "Expected: 403 Forbidden"
curl -s -w "HTTP Status: %{http_code}\n" -X GET "$API_URL/users" \
  -H "Authorization: deny"
echo ""

echo "✅ All tests completed!"
echo ""
echo "📝 Summary of expected responses:"
echo "  - Public endpoint: 200 OK (always accessible)"
echo "  - Authorization: allow → 200 OK"
echo "  - Authorization: deny → 403 Forbidden"
echo "  - Authorization: unauthorized → 401 Unauthorized"
echo "  - Authorization: invalid-token → 500 Internal Server Error"
echo "  - No Authorization header → 401 Unauthorized" 