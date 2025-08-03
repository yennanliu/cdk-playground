#!/bin/bash

# Set the Firehose delivery stream name
DELIVERY_STREAM_NAME="Firehose-os-service-domain-35-cloudwatch-logs-stream"

# Sample stock data
echo "Sending sample stock data to Firehose..."
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

# Wait a few seconds for the data to be processed
echo "Waiting 10 seconds for data to be processed..."
sleep 10

# Search for the data in OpenSearch
echo "Searching for the data in OpenSearch..."
curl -X GET "https://${DOMAIN_ENDPOINT}/_search" \
    -H 'Content-Type: application/json' \
    -u 'admin:Admin@OpenSearch123!' \
    -d '{
  "query": {
    "match": {
      "TICKER_SYMBOL": "QXZ"
    }
  }
}'