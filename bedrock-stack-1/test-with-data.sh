#!/bin/bash

# Test Resume Updater API with real data files
# Usage: ./test-with-data.sh [API_URL]

API_URL=${1:-"https://xxihxfmkka.execute-api.ap-northeast-1.amazonaws.com/prod/"}

echo "================================================"
echo "Testing Resume Updater API with Real Data"
echo "================================================"
echo "API URL: $API_URL"
echo ""

# Read data files
RESUME_TEXT=$(cat data/resume_1.txt)
JD_TEXT=$(cat data/jd_1.txt)

# Escape for JSON
RESUME_JSON=$(echo "$RESUME_TEXT" | jq -Rs .)
JD_JSON=$(echo "$JD_TEXT" | jq -Rs .)

echo "Resume Length: ${#RESUME_TEXT} characters"
echo "Job Description Length: ${#JD_TEXT} characters"
echo ""
echo "Sending request to API..."
echo "----------------------------"
echo ""

# Make API request
RESPONSE=$(curl -s -X POST "${API_URL}update" \
  -H "Content-Type: application/json" \
  -w "\n__HTTP_STATUS__:%{http_code}" \
  -d "{
    \"resumeText\": $RESUME_JSON,
    \"jobDescription\": $JD_JSON,
    \"options\": {
      \"tone\": \"professional\",
      \"format\": \"markdown\"
    }
  }")

# Extract HTTP status
HTTP_STATUS=$(echo "$RESPONSE" | grep "__HTTP_STATUS__" | cut -d':' -f2)
BODY=$(echo "$RESPONSE" | sed '/__HTTP_STATUS__/d')

# Display results
echo "HTTP Status: $HTTP_STATUS"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✓ SUCCESS - API is working!"
  echo ""
  echo "================================================"
  echo "UPDATED RESUME:"
  echo "================================================"
  echo "$BODY" | jq -r '.updatedResume'
  echo ""
  echo "================================================"
  echo "METADATA:"
  echo "================================================"
  echo "$BODY" | jq 'del(.updatedResume)'
else
  echo "✗ ERROR - API request failed"
  echo ""
  echo "Response:"
  echo "$BODY"
fi

echo ""
echo "================================================"
echo "Test complete!"
echo "================================================"
