#!/bin/bash

# Set the Firehose delivery stream name
DELIVERY_STREAM_NAME="Firehose-os-service-domain-35-cloudwatch-logs-stream"

# Sample stock data
echo "Sending sample data to Firehose..."
SAMPLE_DATA='{ 
    "TICKER_SYMBOL": "QXZ",
    "SECTOR": "HEALTHCARE",
    "CHANGE": -0.05,
    "PRICE": 84.51
}'

# Send data to Firehose
aws firehose put-record \
    --cli-binary-format raw-in-base64-out \
    --delivery-stream-name "$DELIVERY_STREAM_NAME" \
    --record '{"Data": '"$(echo "$SAMPLE_DATA" | jq -R -s .)"'}'

echo "Data sent to Firehose. Please wait a few moments for it to appear in OpenSearch..."

# Set the OpenSearch domain endpoint
DOMAIN_ENDPOINT="search-os-service-domain-35-ktp3gklfumornsvrewuv6bc6rm.ap-northeast-1.es.amazonaws.com"

# Wait for the data to be processed
echo "Waiting 30 seconds for data to be processed..."
sleep 30

# Create a temporary file for the AWS credentials
AWS_CREDS=$(aws sts get-session-token)
AWS_ACCESS_KEY_ID=$(echo "$AWS_CREDS" | jq -r '.Credentials.AccessKeyId')
AWS_SECRET_ACCESS_KEY=$(echo "$AWS_CREDS" | jq -r '.Credentials.SecretAccessKey')
AWS_SESSION_TOKEN=$(echo "$AWS_CREDS" | jq -r '.Credentials.SessionToken')

# Search for the data in OpenSearch using signed request
echo "Searching for the data in OpenSearch..."
curl -X GET "https://${DOMAIN_ENDPOINT}/cloudwatch-logs/_search" \
    -H "Content-Type: application/json" \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/$(date -u +%Y%m%d)/ap-northeast-1/es/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=$(date -u +%Y%m%dT%H%M%SZ)" \
    -H "x-amz-date: $(date -u +%Y%m%dT%H%M%SZ)" \
    -H "x-amz-security-token: ${AWS_SESSION_TOKEN}" \
    --insecure \
    -d '{
  "query": {
    "match": {
      "TICKER_SYMBOL": "QXZ"
    }
  }
}'