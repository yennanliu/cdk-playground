#!/bin/bash

# Replace with your OpenSearch domain endpoint
DOMAIN_ENDPOINT="search-os-service-domain-2-sjs2b4wmpcdxszjckj7prf655u.ap-northeast-1.es.amazonaws.com"

# First create the index with mapping if it doesn't exist
echo "Creating index mapping..."
curl -X PUT "https://${DOMAIN_ENDPOINT}/cloudwatch-logs" -H 'Content-Type: application/json' -d'
{
  "settings": {
    "index": {
      "number_of_shards": 1,
      "number_of_replicas": 1
    }
  },
  "mappings": {
    "properties": {
      "timestamp": { "type": "date" },
      "message": { "type": "text" },
      "logStream": { "type": "keyword" },
      "logGroup": { "type": "keyword" }
    }
  }
}'

echo -e "\n\nInserting sample log data..."
# Insert a sample log entry
curl -X POST "https://${DOMAIN_ENDPOINT}/cloudwatch-logs/_doc" -H 'Content-Type: application/json' -d'
{
  "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
  "message": "Sample log message: User login successful for user_id=12345",
  "logStream": "application-logs",
  "logGroup": "/aws/lambda/sample-function"
}'

# Insert another sample log with error
curl -X POST "https://${DOMAIN_ENDPOINT}/cloudwatch-logs/_doc" -H 'Content-Type: application/json' -d'
{
  "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
  "message": "ERROR: Database connection timeout after 30 seconds",
  "logStream": "error-logs",
  "logGroup": "/aws/rds/instance-1"
}'

# You can also use this command to insert custom log data:
echo -e "\n\nExample command to insert custom log data:"
echo 'curl -X POST "https://${DOMAIN_ENDPOINT}/cloudwatch-logs/_doc" -H "Content-Type: application/json" -d'"'"'
{
  "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
  "message": "Your custom log message here",
  "logStream": "your-log-stream",
  "logGroup": "your-log-group"
}'"'"