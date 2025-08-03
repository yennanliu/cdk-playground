#!/bin/bash

# Set the Firehose delivery stream name
DELIVERY_STREAM_NAME="Firehose-os-service-domain-35-cloudwatch-logs-stream"

# Sample stock data
echo "Sending sample stock data to Firehose..."

# Create the data with newline
RECORD_DATA="{\"symbol\":\"QXZ\",\"sector\":\"HEALTHCARE\",\"price_change\":-0.05,\"current_price\":84.51}"

# Debug: Show the data being sent
echo "Raw data to be sent:"
echo "$RECORD_DATA"

# Encode the data
ENCODED_DATA=$(echo -n "$RECORD_DATA" | base64)

echo "Base64 encoded data:"
echo "$ENCODED_DATA"

echo "Decoded data (verification):"
echo "$ENCODED_DATA" | base64 -d

# Send to Firehose
aws firehose put-record \
    --delivery-stream-name "$DELIVERY_STREAM_NAME" \
    --record "{\"Data\":\"$ENCODED_DATA\"}"

echo "Data sent to Firehose. Please wait a few moments for it to appear in OpenSearch..."

# Set the OpenSearch domain endpoint
DOMAIN_ENDPOINT="search-os-service-domain-35-ktp3gklfumornsvrewuv6bc6rm.ap-northeast-1.es.amazonaws.com"

# Wait for the data to be processed
echo "Waiting 30 seconds for data to be processed..."
sleep 30

# First check if the index exists
echo "Checking if index exists..."
aws opensearch describe-domain \
    --domain-name os-service-domain-35

# List all indices
echo -e "\nListing indices..."
aws opensearch list-domain-names

# Check Firehose delivery stream status
echo -e "\nChecking Firehose delivery stream status..."
aws firehose describe-delivery-stream \
    --delivery-stream-name "$DELIVERY_STREAM_NAME"

# Check CloudWatch logs for any Firehose errors
echo -e "\nChecking CloudWatch logs for Firehose errors..."
LOG_GROUP="/aws/kinesisfirehose/${DELIVERY_STREAM_NAME}"
aws logs get-log-events \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name "Firehose-os-service-domain-35-OpenSearchDelivery" \
    --limit 5 || echo "No CloudWatch logs found"