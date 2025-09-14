#!/bin/bash

# Image Recognition API Test Script
# Usage: ./test-api.sh <API_ENDPOINT> <IMAGE_FILE>
# Example: ./test-api.sh https://abc123.execute-api.us-east-1.amazonaws.com/prod test-image.jpg

set -e  # Exit on any error

if [ $# -ne 2 ]; then
    echo "Usage: $0 <API_ENDPOINT> <IMAGE_FILE>"
    echo "Example: $0 https://abc123.execute-api.us-east-1.amazonaws.com/prod test-image.jpg"
    exit 1
fi

API_ENDPOINT="$1"
IMAGE_FILE="$2"

# Remove trailing slash from endpoint
API_ENDPOINT=$(echo "$API_ENDPOINT" | sed 's|/*$||')

# Check if image file exists
if [ ! -f "$IMAGE_FILE" ]; then
    echo "Error: Image file '$IMAGE_FILE' not found"
    exit 1
fi

# Get file type
MIME_TYPE=$(file -b --mime-type "$IMAGE_FILE")
if [[ ! $MIME_TYPE == image/* ]]; then
    echo "Error: '$IMAGE_FILE' is not an image file (detected type: $MIME_TYPE)"
    exit 1
fi

FILENAME=$(basename "$IMAGE_FILE")

echo "🚀 Starting Image Recognition API Test"
echo "📍 API Endpoint: $API_ENDPOINT"
echo "🖼️  Image File: $IMAGE_FILE"
echo "📋 MIME Type: $MIME_TYPE"
echo ""

# Step 1: Test API status
echo "1️⃣  Testing API status..."
API_STATUS=$(curl -s -w "%{http_code}" -o /tmp/api_response.json "$API_ENDPOINT/")
if [ "$API_STATUS" -eq 200 ]; then
    echo "✅ API is responsive"
    echo "   Response: $(cat /tmp/api_response.json | jq -r '.message' 2>/dev/null || cat /tmp/api_response.json)"
else
    echo "❌ API status check failed (HTTP $API_STATUS)"
    echo "   Response: $(cat /tmp/api_response.json)"
    exit 1
fi

echo ""

# Step 2: Get presigned URL
echo "2️⃣  Getting presigned upload URL..."
UPLOAD_RESPONSE=$(curl -s -X POST "$API_ENDPOINT/upload-url" \
    -H "Content-Type: application/json" \
    -d "{\"fileName\": \"$FILENAME\", \"fileType\": \"$MIME_TYPE\"}")

# Check if response contains error
if echo "$UPLOAD_RESPONSE" | grep -q '"error"'; then
    echo "❌ Failed to get upload URL"
    echo "   Error: $UPLOAD_RESPONSE"
    exit 1
fi

# Extract values
UPLOAD_URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.uploadUrl')
IMAGE_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.imageId')
KEY=$(echo "$UPLOAD_RESPONSE" | jq -r '.key')

if [ "$UPLOAD_URL" = "null" ] || [ "$IMAGE_ID" = "null" ] || [ "$KEY" = "null" ]; then
    echo "❌ Invalid response from upload-url endpoint"
    echo "   Response: $UPLOAD_RESPONSE"
    exit 1
fi

echo "✅ Got presigned URL"
echo "   Image ID: $IMAGE_ID"
echo "   S3 Key: $KEY"

echo ""

# Step 3: Upload image to S3
echo "3️⃣  Uploading image to S3..."
UPLOAD_STATUS=$(curl -s -w "%{http_code}" -o /tmp/s3_response.txt -X PUT "$UPLOAD_URL" \
    -H "Content-Type: $MIME_TYPE" \
    --data-binary "@$IMAGE_FILE")

if [ "$UPLOAD_STATUS" -eq 200 ]; then
    echo "✅ Image uploaded successfully to S3"
else
    echo "❌ S3 upload failed (HTTP $UPLOAD_STATUS)"
    echo "   Response: $(cat /tmp/s3_response.txt)"
    exit 1
fi

echo ""

# Step 4: Process image
echo "4️⃣  Processing image with Rekognition..."
PROCESS_RESPONSE=$(curl -s -X POST "$API_ENDPOINT/process-image" \
    -H "Content-Type: application/json" \
    -d "{\"imageId\": \"$IMAGE_ID\", \"key\": \"$KEY\"}")

# Check if response contains error
if echo "$PROCESS_RESPONSE" | grep -q '"error"'; then
    echo "❌ Failed to process image"
    echo "   Error: $PROCESS_RESPONSE"
    exit 1
fi

echo "✅ Image processed successfully"

# Display results
LABELS=$(echo "$PROCESS_RESPONSE" | jq -r '.labels[]? | "\(.Name) (\(.Confidence | round)%)"')
if [ -n "$LABELS" ]; then
    echo "🏷️  Detected Labels:"
    echo "$LABELS" | sed 's/^/   • /'
else
    echo "   No labels detected"
fi

echo ""

# Step 5: Get results (optional verification)
echo "5️⃣  Verifying results in database..."
RESULTS_RESPONSE=$(curl -s "$API_ENDPOINT/results/$IMAGE_ID")

if echo "$RESULTS_RESPONSE" | grep -q '"error"'; then
    echo "⚠️  Could not retrieve results from database"
    echo "   Error: $RESULTS_RESPONSE"
else
    echo "✅ Results stored in database successfully"
    STORED_LABELS=$(echo "$RESULTS_RESPONSE" | jq -r '.labels[]? | "\(.Name) (\(.Confidence | round)%)"')
    if [ -n "$STORED_LABELS" ]; then
        echo "   Stored labels count: $(echo "$RESULTS_RESPONSE" | jq '.labels | length')"
    fi
fi

echo ""
echo "🎉 Image recognition test completed successfully!"
echo ""
echo "Summary:"
echo "- Image ID: $IMAGE_ID"
echo "- S3 Key: $KEY"
echo "- Labels detected: $(echo "$PROCESS_RESPONSE" | jq '.labels | length')"

# Cleanup temp files
rm -f /tmp/api_response.json /tmp/s3_response.txt