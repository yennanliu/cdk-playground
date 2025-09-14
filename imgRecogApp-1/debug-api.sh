#!/bin/bash

API_ENDPOINT="https://9boi6duu7e.execute-api.ap-northeast-1.amazonaws.com/prod"

echo "🔍 Debugging Image Recognition API"
echo "API Endpoint: $API_ENDPOINT"
echo ""

# Test 1: Root endpoint
echo "1️⃣ Testing Root Endpoint..."
echo "Command: curl -s -w 'HTTP %{http_code}' $API_ENDPOINT/"
RESPONSE=$(curl -s -w "HTTP %{http_code}" "$API_ENDPOINT/")
echo "Response: $RESPONSE"
echo ""

# Test 2: Upload URL endpoint
echo "2️⃣ Testing Upload URL Endpoint..."
echo "Command: curl -s -w 'HTTP %{http_code}' -X POST $API_ENDPOINT/upload-url -H 'Content-Type: application/json' -d '{\"fileName\": \"test.jpg\", \"fileType\": \"image/jpeg\"}'"
UPLOAD_RESPONSE=$(curl -s -w "HTTP %{http_code}" -X POST "$API_ENDPOINT/upload-url" \
  -H "Content-Type: application/json" \
  -d '{"fileName": "test.jpg", "fileType": "image/jpeg"}')
echo "Response: $UPLOAD_RESPONSE"
echo ""

# Test 3: Check if it's a CORS issue
echo "3️⃣ Testing with CORS headers..."
echo "Command: curl -s -w 'HTTP %{http_code}' -X OPTIONS $API_ENDPOINT/ -H 'Origin: http://localhost'"
CORS_RESPONSE=$(curl -s -w "HTTP %{http_code}" -X OPTIONS "$API_ENDPOINT/" -H "Origin: http://localhost")
echo "Response: $CORS_RESPONSE"
echo ""

# Test 4: Verbose curl to see detailed error
echo "4️⃣ Detailed Error Information..."
echo "Command: curl -v $API_ENDPOINT/ 2>&1 | head -20"
curl -v "$API_ENDPOINT/" 2>&1 | head -20
echo ""

echo "🎯 Analysis:"
if [[ "$RESPONSE" == *"Internal server error"* ]]; then
    echo "❌ Lambda function is failing (Internal Server Error)"
    echo "💡 Likely causes:"
    echo "   - New Lambda code not deployed"
    echo "   - Missing dependencies in Lambda"
    echo "   - Environment variables not set"
    echo "   - Permission issues"
elif [[ "$RESPONSE" == *"Missing Authentication Token"* ]]; then
    echo "❌ API Gateway routing issue"
    echo "💡 API Gateway not properly configured"
else
    echo "✅ API might be working - check response above"
fi

echo ""
echo "🚀 Recommended next steps:"
echo "1. Redeploy the stack: cdk deploy"
echo "2. Check CloudWatch logs for Lambda errors"
echo "3. Verify Lambda function has proper code and dependencies"