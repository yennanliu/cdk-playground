#!/bin/bash

# Test script for Resume Updater API
# Usage: ./test-resume-updater.sh <API_URL>

API_URL=${1:-"YOUR-API-URL"}

if [ "$API_URL" = "YOUR-API-URL" ]; then
  echo "Error: Please provide the API URL"
  echo "Usage: ./test-resume-updater.sh <API_URL>"
  echo ""
  echo "Example:"
  echo "  ./test-resume-updater.sh https://abc123.execute-api.us-east-1.amazonaws.com/prod/"
  exit 1
fi

echo "Testing Resume Updater API at: $API_URL"
echo ""

# Test request
curl -X POST "${API_URL}update" \
  -H "Content-Type: application/json" \
  -d '{
    "resumeText": "John Doe\nSoftware Engineer\n\nExperience:\n- Built web applications using JavaScript\n- Worked with databases and APIs\n- Collaborated with team members\n\nSkills: JavaScript, SQL, REST APIs",
    "jobDescription": "We are seeking a Full Stack Developer with strong React and Node.js experience to build modern web applications. Must have experience with RESTful APIs, databases, and cloud platforms. Strong teamwork and communication skills required.",
    "options": {
      "tone": "professional",
      "format": "markdown"
    }
  }' | jq .

echo ""
echo "Test complete!"
