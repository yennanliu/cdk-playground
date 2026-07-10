#!/bin/bash

# Script to test OpenSearch index creation after deployment
echo "Testing OpenSearch index auto-creation..."

# Get the OpenSearch endpoint from CloudFormation outputs
STACK_NAME="OSServiceDomainCDKStack-opensearch-domain-dev-3"
OPENSEARCH_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenSearchDomainEndpoint`].OutputValue' \
  --output text 2>/dev/null)

if [ -z "$OPENSEARCH_ENDPOINT" ]; then
    echo "❌ Could not get OpenSearch endpoint from stack outputs"
    exit 1
fi

echo "✅ OpenSearch endpoint: $OPENSEARCH_ENDPOINT"

# Check for indices
echo "Checking for indices..."
curl -s -u admin:Admin@OpenSearch123! \
  "https://$OPENSEARCH_ENDPOINT/_cat/indices?v" \
  | grep -E "(eks-logs|pod-logs)" || echo "ℹ️  No eks-logs or pod-logs indices found yet"

# Check for index templates
echo "Checking for index templates..."
curl -s -u admin:Admin@OpenSearch123! \
  "https://$OPENSEARCH_ENDPOINT/_index_template" \
  | jq -r '.index_templates[] | select(.name | contains("logs")) | .name' 2>/dev/null || echo "ℹ️  Could not check templates (may need jq installed)"

echo ""
echo "🔍 To manually check indices, visit:"
echo "   https://$OPENSEARCH_ENDPOINT/_dashboards/"
echo "   Username: admin"
echo "   Password: Admin@OpenSearch123!"