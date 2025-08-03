#!/bin/bash

# Set the OpenSearch domain endpoint
DOMAIN_ENDPOINT="search-os-service-domain-35-ktp3gklfumornsvrewuv6bc6rm.ap-northeast-1.es.amazonaws.com"

# Get temporary AWS credentials
AWS_CREDS=$(aws sts get-session-token)
AWS_ACCESS_KEY_ID=$(echo "$AWS_CREDS" | jq -r '.Credentials.AccessKeyId')
AWS_SECRET_ACCESS_KEY=$(echo "$AWS_CREDS" | jq -r '.Credentials.SecretAccessKey')
AWS_SESSION_TOKEN=$(echo "$AWS_CREDS" | jq -r '.Credentials.SessionToken')

# First, list all indices
echo "Listing indices..."
curl -X GET "https://${DOMAIN_ENDPOINT}/_cat/indices" \
    -H "Content-Type: application/json" \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/$(date -u +%Y%m%d)/ap-northeast-1/es/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=$(date -u +%Y%m%dT%H%M%SZ)" \
    -H "x-amz-date: $(date -u +%Y%m%dT%H%M%SZ)" \
    -H "x-amz-security-token: ${AWS_SESSION_TOKEN}" \
    --insecure

# Then search for our data
echo -e "\nSearching for data..."
curl -X GET "https://${DOMAIN_ENDPOINT}/cloudwatch-logs/_search" \
    -H "Content-Type: application/json" \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY_ID}/$(date -u +%Y%m%d)/ap-northeast-1/es/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=$(date -u +%Y%m%dT%H%M%SZ)" \
    -H "x-amz-date: $(date -u +%Y%m%dT%H%M%SZ)" \
    -H "x-amz-security-token: ${AWS_SESSION_TOKEN}" \
    --insecure \
    -d '{
  "query": {
    "match_all": {}
  }
}'