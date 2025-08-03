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

# Try to access OpenSearch with basic auth
echo "Trying to access OpenSearch with basic auth..."
curl -X GET "https://${DOMAIN_ENDPOINT}/_cat/indices" \
    -u "admin:Admin@OpenSearch123!" \
    -k

echo -e "\nTrying to search the index..."
curl -X GET "https://${DOMAIN_ENDPOINT}/cloudwatch-logs/_search" \
    -H 'Content-Type: application/json' \
    -u "admin:Admin@OpenSearch123!" \
    -k \
    -d '{
  "query": {
    "match_all": {}
  }
}'