#!/bin/bash

# Check if bucket name and API URL are provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: ./update-api-url.sh <bucket-name> <api-url>"
  echo "Example: ./update-api-url.sh my-website-bucket https://abcdef123.execute-api.us-east-1.amazonaws.com/prod/game"
  exit 1
fi

BUCKET_NAME=$1
API_URL=$2

echo "Updating API URL in index.html to: $API_URL"

# Create a temporary directory
TEMP_DIR=$(mktemp -d)
echo "Created temporary directory: $TEMP_DIR"

# Download the index.html file from S3
echo "Downloading index.html from S3..."
aws s3 cp s3://$BUCKET_NAME/index.html $TEMP_DIR/index.html

if [ $? -ne 0 ]; then
  echo "Error downloading index.html from S3 bucket"
  rm -rf $TEMP_DIR
  exit 1
fi

# Replace the API URL placeholder
echo "Replacing API URL placeholder..."
sed -i.bak "s|##API_ENDPOINT##|$API_URL|g" $TEMP_DIR/index.html

if [ $? -ne 0 ]; then
  echo "Error replacing API URL in index.html"
  rm -rf $TEMP_DIR
  exit 1
fi

# Upload the updated file back to S3
echo "Uploading updated index.html back to S3..."
aws s3 cp $TEMP_DIR/index.html s3://$BUCKET_NAME/index.html --content-type "text/html"

if [ $? -ne 0 ]; then
  echo "Error uploading updated index.html to S3 bucket"
  rm -rf $TEMP_DIR
  exit 1
fi

# Clean up
rm -rf $TEMP_DIR
echo "Temporary directory removed"

echo "API URL updated successfully!"
echo "Your website should now be configured to use the API at: $API_URL" 