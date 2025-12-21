#!/bin/bash

# Test script for file upload flow
# Usage: ./test-file-upload.sh <API_URL> <RESUME_FILE> <JOB_DESCRIPTION_FILE>

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -lt 1 ]; then
    echo "Usage: $0 <API_URL> [RESUME_FILE] [JOB_DESCRIPTION_FILE]"
    echo "Example: $0 https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/ data/resume_1.txt data/jd_1.txt"
    exit 1
fi

API_URL=${1%/}  # Remove trailing slash if present
RESUME_FILE=${2:-data/resume_1.txt}
JD_FILE=${3:-data/jd_1.txt}

# Check if files exist
if [ ! -f "$RESUME_FILE" ]; then
    echo "Error: Resume file not found: $RESUME_FILE"
    exit 1
fi

if [ ! -f "$JD_FILE" ]; then
    echo "Error: Job description file not found: $JD_FILE"
    exit 1
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Resume Updater - File Upload Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}API URL:${NC} $API_URL"
echo -e "${YELLOW}Resume File:${NC} $RESUME_FILE"
echo -e "${YELLOW}Job Description File:${NC} $JD_FILE"
echo ""

# Step 1: Get presigned upload URL
echo -e "${GREEN}Step 1:${NC} Getting presigned upload URL..."
UPLOAD_RESPONSE=$(curl -s -X POST "${API_URL}/upload" \
  -H "Content-Type: application/json" \
  -d "{\"fileName\": \"$(basename $RESUME_FILE)\"}")

echo "Response: $UPLOAD_RESPONSE"

# Extract upload URL and key using jq (or basic parsing if jq not available)
if command -v jq &> /dev/null; then
    UPLOAD_URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.uploadUrl')
    S3_KEY=$(echo "$UPLOAD_RESPONSE" | jq -r '.key')
else
    # Fallback: basic parsing without jq
    UPLOAD_URL=$(echo "$UPLOAD_RESPONSE" | grep -o '"uploadUrl":"[^"]*"' | cut -d'"' -f4)
    S3_KEY=$(echo "$UPLOAD_RESPONSE" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$UPLOAD_URL" ] || [ "$UPLOAD_URL" == "null" ]; then
    echo -e "${YELLOW}Error: Failed to get presigned URL${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Got presigned URL"
echo -e "${YELLOW}S3 Key:${NC} $S3_KEY"
echo ""

# Step 2: Upload file to S3
echo -e "${GREEN}Step 2:${NC} Uploading resume to S3..."
UPLOAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD_URL" \
  --upload-file "$RESUME_FILE" \
  -H "Content-Type: text/plain")

if [ "$UPLOAD_STATUS" != "200" ]; then
    echo -e "${YELLOW}Error: Upload failed with status code $UPLOAD_STATUS${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Resume uploaded successfully"
echo ""

# Step 3: Read job description
echo -e "${GREEN}Step 3:${NC} Reading job description..."
JD_CONTENT=$(cat "$JD_FILE")
echo -e "${GREEN}✓${NC} Job description loaded (${#JD_CONTENT} characters)"
echo ""

# Step 4: Process resume with Bedrock
echo -e "${GREEN}Step 4:${NC} Processing resume with AI..."
echo -e "${YELLOW}This may take 10-30 seconds...${NC}"
echo ""

# Create request payload
REQUEST_PAYLOAD=$(cat <<EOF
{
  "resumeS3Key": "$S3_KEY",
  "jobDescription": $(echo "$JD_CONTENT" | jq -Rs .),
  "options": {
    "tone": "professional",
    "format": "markdown"
  }
}
EOF
)

RESULT=$(curl -s -X POST "${API_URL}/update" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_PAYLOAD")

echo "$RESULT" | jq . 2>/dev/null || echo "$RESULT"
echo ""

# Save result to output directory
if command -v jq &> /dev/null; then
    UPDATED_RESUME=$(echo "$RESULT" | jq -r '.updatedResume')
    if [ ! -z "$UPDATED_RESUME" ] && [ "$UPDATED_RESUME" != "null" ]; then
        mkdir -p output
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        OUTPUT_FILE="output/resume_updated_${TIMESTAMP}.txt"
        echo "$UPDATED_RESUME" > "$OUTPUT_FILE"
        echo -e "${GREEN}✓${NC} Updated resume saved to: ${BLUE}$OUTPUT_FILE${NC}"
    fi
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Test completed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
