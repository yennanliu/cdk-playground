#!/bin/bash

# Set the OpenSearch domain endpoint
DOMAIN_ENDPOINT="search-os-service-domain-35-ktp3gklfumornsvrewuv6bc6rm.ap-northeast-1.es.amazonaws.com"

# First, check if the index exists
echo "Checking if index exists..."
aws opensearch describe-domain \
    --domain-name os-service-domain-35

# Then try to list indices
echo -e "\nListing indices..."
aws opensearch list-domain-names

# Try to get the index mapping
echo -e "\nGetting index mapping..."
aws opensearch get-package \
    --domain-name os-service-domain-35 \
    --package-id cloudwatch-logs || echo "Failed to get index mapping"

# Try to search the index
echo -e "\nSearching the index..."
aws opensearch get-package-version \
    --domain-name os-service-domain-35 \
    --package-id cloudwatch-logs \
    --package-version latest || echo "Failed to search index"