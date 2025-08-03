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

ENCODED_DATA=$(echo "$SAMPLE_DATA" | base64)

aws firehose put-record \
    --delivery-stream-name "$DELIVERY_STREAM_NAME" \
    --record "{\"Data\":\"$ENCODED_DATA\"}"

echo "Data sent to Firehose. Please wait a few moments for it to appear in OpenSearch..."

# Set the OpenSearch domain endpoint
DOMAIN_ENDPOINT="search-os-service-domain-35-ktp3gklfumornsvrewuv6bc6rm.ap-northeast-1.es.amazonaws.com"

# Wait for the data to be processed
echo "Waiting 30 seconds for data to be processed..."
sleep 30

# Search for the data in OpenSearch using AWS Signature v4
echo "Searching for the data in OpenSearch..."
aws opensearch get-package-version-history \
    --domain-name os-service-domain-35 \
    --package-id cloudwatch-logs \
    --max-results 10