#!/bin/bash

# Set the OpenSearch domain endpoint
DOMAIN_ENDPOINT="search-os-service-domain-35-ktp3gklfumornsvrewuv6bc6rm.ap-northeast-1.es.amazonaws.com"

# First, list all indices
echo "Listing indices..."
curl -X GET "https://${DOMAIN_ENDPOINT}/_cat/indices" \
    -H 'Content-Type: application/json' \
    -u "admin:Admin@OpenSearch123!" \
    --insecure

# Then search for our data
echo -e "\nSearching for data..."
curl -X GET "https://${DOMAIN_ENDPOINT}/cloudwatch-logs/_search" \
    -H 'Content-Type: application/json' \
    -u "admin:Admin@OpenSearch123!" \
    --insecure \
    -d '{
  "query": {
    "match_all": {}
  }
}'