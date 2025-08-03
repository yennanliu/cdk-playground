#!/bin/bash

DOMAIN_ENDPOINT="search-os-service-domain-35-ktp3gklfumornsvrewuv6bc6rm.ap-northeast-1.es.amazonaws.com"

# Create the index with mapping
echo "Creating index mapping..."
curl -X PUT "https://${DOMAIN_ENDPOINT}/cloudwatch-logs" \
    -H 'Content-Type: application/json' \
    -u "admin:Admin@OpenSearch123!" \
    --insecure \
    -d '{
  "settings": {
    "index": {
      "number_of_shards": 1,
      "number_of_replicas": 1
    }
  },
  "mappings": {
    "properties": {
      "TICKER_SYMBOL": { "type": "keyword" },
      "SECTOR": { "type": "keyword" },
      "CHANGE": { "type": "float" },
      "PRICE": { "type": "float" }
    }
  }
}'