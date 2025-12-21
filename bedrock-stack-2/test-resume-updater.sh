#!/bin/bash

# Test script for Resume Updater API
# Usage: ./test-resume-updater.sh [API_URL]

API_URL=${1:-"YOUR-API-URL"}

if [ "$API_URL" = "YOUR-API-URL" ]; then
  echo "Error: Please provide the API URL"
  echo "Usage: ./test-resume-updater.sh <API_URL>"
  echo ""
  echo "Example:"
  echo "  ./test-resume-updater.sh https://xxihxfmkka.execute-api.ap-northeast-1.amazonaws.com/prod/"
  exit 1
fi

echo "================================================"
echo "Testing Resume Updater API"
echo "================================================"
echo "API URL: $API_URL"
echo ""

# Test 1: Basic resume update
echo "Test 1: Basic Resume Update"
echo "----------------------------"
curl -X POST "${API_URL}update" \
  -H "Content-Type: application/json" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -d '{
    "resumeText": "John Doe\nSoftware Engineer\n\nExperience:\n- Built web applications using JavaScript\n- Worked with databases and APIs\n- Collaborated with team members\n\nSkills: JavaScript, SQL, REST APIs",
    "jobDescription": "We are seeking a Full Stack Developer with strong React and Node.js experience to build modern web applications. Must have experience with RESTful APIs, databases, and cloud platforms. Strong teamwork and communication skills required.",
    "options": {
      "tone": "professional",
      "format": "markdown"
    }
  }'

echo ""
echo ""
echo "================================================"
echo "Test complete!"
echo "================================================"
echo ""
echo "If you see an updated resume above, your API is working! ✓"
echo ""
