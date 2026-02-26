#!/bin/bash
# Upload training data to S3

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ENV=${1}
LOCAL_PATH=${2}

if [ -z "$ENV" ] || [ -z "$LOCAL_PATH" ]; then
    echo "Usage: $0 <env> <local-path-to-data>"
    echo "Example: $0 dev ./data/train.jsonl"
    exit 1
fi

BUCKET="${ENV}-post-train-data"

echo -e "${GREEN}=== Uploading training data to S3 ===${NC}"
echo "Environment: $ENV"
echo "Local Path: $LOCAL_PATH"
echo "S3 Bucket: $BUCKET"
echo

# Check if bucket exists
if ! aws s3 ls "s3://$BUCKET" >/dev/null 2>&1; then
    echo -e "${RED}Error: S3 bucket $BUCKET does not exist${NC}"
    echo "Please deploy the CDK stack first: ./scripts/bootstrap.sh $ENV"
    exit 1
fi

# Check if local path exists
if [ ! -e "$LOCAL_PATH" ]; then
    echo -e "${RED}Error: Local path $LOCAL_PATH does not exist${NC}"
    exit 1
fi

# Upload data
echo -e "${YELLOW}Uploading data...${NC}"
if [ -d "$LOCAL_PATH" ]; then
    # Upload directory
    aws s3 cp "$LOCAL_PATH" "s3://$BUCKET/raw/" --recursive
else
    # Upload file
    aws s3 cp "$LOCAL_PATH" "s3://$BUCKET/raw/"
fi

echo
echo -e "${GREEN}=== Upload complete ===${NC}"
echo
echo "Data available at: s3://$BUCKET/raw/"
echo
echo "Next steps:"
echo "1. Process/validate your data if needed"
echo "2. Move processed data to s3://$BUCKET/processed/"
echo "3. Submit training job with the processed data path"
