#!/bin/bash

# Test Resume Updater API with real data files
# Usage: ./test-with-data.sh [OPTIONS]
#
# Options:
#   -a, --api-url URL       API URL (default: https://xxihxfmkka.execute-api.ap-northeast-1.amazonaws.com/prod/)
#   -r, --resume FILE       Resume file path (default: data/resume_1.txt)
#   -j, --jd FILE           Job description file path (default: data/jd_1.txt)
#   -h, --help              Show this help message
#
# Examples:
#   ./test-with-data.sh
#   ./test-with-data.sh -r my_resume.txt -j my_job.txt
#   ./test-with-data.sh --api-url https://custom.api.com/prod/ -r resume.txt

# Default values
API_URL="https://xxihxfmkka.execute-api.ap-northeast-1.amazonaws.com/prod/"
RESUME_FILE="data/resume_1.txt"
JD_FILE="data/jd_1.txt"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -a|--api-url)
      API_URL="$2"
      shift 2
      ;;
    -r|--resume)
      RESUME_FILE="$2"
      shift 2
      ;;
    -j|--jd)
      JD_FILE="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: ./test-with-data.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  -a, --api-url URL       API URL"
      echo "  -r, --resume FILE       Resume file path (default: data/resume_1.txt)"
      echo "  -j, --jd FILE           Job description file path (default: data/jd_1.txt)"
      echo "  -h, --help              Show this help message"
      echo ""
      echo "Examples:"
      echo "  ./test-with-data.sh"
      echo "  ./test-with-data.sh -r my_resume.txt -j my_job.txt"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use -h or --help for usage information"
      exit 1
      ;;
  esac
done

# Check if files exist
if [ ! -f "$RESUME_FILE" ]; then
  echo "Error: Resume file not found: $RESUME_FILE"
  exit 1
fi

if [ ! -f "$JD_FILE" ]; then
  echo "Error: Job description file not found: $JD_FILE"
  exit 1
fi

echo "================================================"
echo "Testing Resume Updater API with Real Data"
echo "================================================"
echo "API URL: $API_URL"
echo "Resume: $RESUME_FILE"
echo "Job Description: $JD_FILE"
echo ""

# Read data files
RESUME_TEXT=$(cat "$RESUME_FILE")
JD_TEXT=$(cat "$JD_FILE")

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

# Create output directory if it doesn't exist
OUTPUT_DIR="output"
mkdir -p "$OUTPUT_DIR"

# Generate timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="${OUTPUT_DIR}/resume_updated_${TIMESTAMP}.txt"

# Display results
echo "HTTP Status: $HTTP_STATUS"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✓ SUCCESS - API is working!"
  echo ""

  # Extract updated resume
  UPDATED_RESUME=$(echo "$BODY" | jq -r '.updatedResume')
  METADATA=$(echo "$BODY" | jq 'del(.updatedResume)')

  # Save to file
  cat > "$OUTPUT_FILE" <<EOF
================================================
RESUME UPDATER - TEST RESULTS
================================================
Timestamp: $(date)
Resume File: $RESUME_FILE
Job Description: $JD_FILE
API URL: $API_URL

================================================
UPDATED RESUME:
================================================
$UPDATED_RESUME

================================================
METADATA:
================================================
$METADATA

================================================
ORIGINAL RESUME:
================================================
$RESUME_TEXT

================================================
JOB DESCRIPTION:
================================================
$JD_TEXT
EOF

  echo "================================================"
  echo "UPDATED RESUME:"
  echo "================================================"
  echo "$UPDATED_RESUME"
  echo ""
  echo "================================================"
  echo "METADATA:"
  echo "================================================"
  echo "$METADATA"
  echo ""
  echo "✓ Output saved to: $OUTPUT_FILE"
else
  echo "✗ ERROR - API request failed"
  echo ""
  echo "Response:"
  echo "$BODY"

  # Save error to file
  cat > "$OUTPUT_FILE" <<EOF
================================================
RESUME UPDATER - ERROR LOG
================================================
Timestamp: $(date)
Resume File: $RESUME_FILE
Job Description: $JD_FILE
API URL: $API_URL
HTTP Status: $HTTP_STATUS

================================================
ERROR RESPONSE:
================================================
$BODY
EOF

  echo ""
  echo "✗ Error log saved to: $OUTPUT_FILE"
fi

echo ""
echo "================================================"
echo "Test complete!"
echo "================================================"
