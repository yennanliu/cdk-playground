#!/bin/bash
# Manual script to configure OpenSearch role mapping for Firehose using curl

set -e

# Default values
REGION="us-east-1"
USERNAME="admin"
PASSWORD="Admin@OpenSearch123!"
VERIFY_ONLY=false

# Function to display usage
usage() {
    echo "Usage: $0 --stack-name STACK_NAME [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --stack-name          CloudFormation stack name (required)"
    echo "  --region              AWS region (default: us-east-1)"
    echo "  --username            OpenSearch master username (default: admin)"
    echo "  --password            OpenSearch master password (default: Admin@OpenSearch123!)"
    echo "  --domain-endpoint     OpenSearch domain endpoint (optional, will get from stack)"
    echo "  --firehose-role-arn   Firehose role ARN (optional, will get from stack)"
    echo "  --verify-only         Only verify existing role mapping"
    echo "  --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --stack-name my-opensearch-stack"
    echo "  $0 --stack-name my-stack --region us-west-2"
    echo "  $0 --stack-name my-stack --verify-only"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        --username)
            USERNAME="$2"
            shift 2
            ;;
        --password)
            PASSWORD="$2"
            shift 2
            ;;
        --domain-endpoint)
            DOMAIN_ENDPOINT="$2"
            shift 2
            ;;
        --firehose-role-arn)
            FIREHOSE_ROLE_ARN="$2"
            shift 2
            ;;
        --verify-only)
            VERIFY_ONLY=true
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Check if stack name is provided
if [[ -z "$STACK_NAME" ]]; then
    echo "Error: --stack-name is required"
    usage
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    exit 1
fi

# Check if curl is installed
if ! command -v curl &> /dev/null; then
    echo "Error: curl is not installed"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed (required for JSON parsing)"
    exit 1
fi

echo "============================================================"
echo "OpenSearch Role Mapping Configuration"
echo "============================================================"
echo "Stack Name: $STACK_NAME"
echo "Region: $REGION"
echo "Username: $USERNAME"
echo ""

# Get stack outputs if not provided
if [[ -z "$DOMAIN_ENDPOINT" ]] || [[ -z "$FIREHOSE_ROLE_ARN" ]]; then
    echo "Getting stack outputs..."
    STACK_OUTPUTS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs' \
        --output json 2>/dev/null)
    
    if [[ $? -ne 0 ]] || [[ -z "$STACK_OUTPUTS" ]]; then
        echo "Error: Could not get stack outputs for $STACK_NAME"
        exit 1
    fi
    
    echo "Available stack outputs:"
    echo "$STACK_OUTPUTS" | jq -r '.[] | "  \(.OutputKey): \(.OutputValue)"'
    echo ""
    
    # Get domain endpoint if not provided
    if [[ -z "$DOMAIN_ENDPOINT" ]]; then
        DOMAIN_ENDPOINT=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey | test(".*[Dd]omain.*[Ee]ndpoint.*")) | .OutputValue' | head -1)
        if [[ -z "$DOMAIN_ENDPOINT" ]] || [[ "$DOMAIN_ENDPOINT" == "null" ]]; then
            echo "Error: Could not find OpenSearch domain endpoint in stack outputs"
            echo "Please provide --domain-endpoint manually"
            exit 1
        fi
    fi
    
    # Get Firehose role ARN if not provided
    if [[ -z "$FIREHOSE_ROLE_ARN" ]]; then
        FIREHOSE_ROLE_ARN=$(echo "$STACK_OUTPUTS" | jq -r '.[] | select(.OutputKey | test(".*[Ff]irehose.*[Rr]ole.*[Aa]rn.*")) | .OutputValue' | head -1)
        if [[ -z "$FIREHOSE_ROLE_ARN" ]] || [[ "$FIREHOSE_ROLE_ARN" == "null" ]]; then
            echo "Error: Could not find Firehose role ARN in stack outputs"
            echo "Please provide --firehose-role-arn manually"
            exit 1
        fi
    fi
fi

# Remove https:// prefix if present
DOMAIN_ENDPOINT=${DOMAIN_ENDPOINT#https://}

echo "Domain Endpoint: $DOMAIN_ENDPOINT"
echo "Firehose Role ARN: $FIREHOSE_ROLE_ARN"
echo ""

# Function to verify role mapping
verify_role_mapping() {
    echo "Verifying current role mapping..."
    
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X GET \
        -u "$USERNAME:$PASSWORD" \
        -H "Content-Type: application/json" \
        "https://$DOMAIN_ENDPOINT/_plugins/_security/api/rolesmapping/all_access")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [[ "$HTTP_CODE" -eq 200 ]]; then
        echo "✅ Current role mapping configuration:"
        echo "$BODY" | jq .
        return 0
    else
        echo "❌ Failed to get role mapping (HTTP $HTTP_CODE):"
        echo "$BODY"
        return 1
    fi
}

# Function to configure role mapping
configure_role_mapping() {
    echo "Configuring role mapping..."
    
    # Create role mapping JSON
    ROLE_MAPPING=$(cat <<EOF
{
  "backend_roles": ["$FIREHOSE_ROLE_ARN"],
  "hosts": [],
  "users": [],
  "reserved": false
}
EOF
)
    
    echo "Role mapping to be applied:"
    echo "$ROLE_MAPPING" | jq .
    echo ""
    
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X PUT \
        -u "$USERNAME:$PASSWORD" \
        -H "Content-Type: application/json" \
        -d "$ROLE_MAPPING" \
        "https://$DOMAIN_ENDPOINT/_plugins/_security/api/rolesmapping/all_access")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)
    
    if [[ "$HTTP_CODE" -eq 200 ]] || [[ "$HTTP_CODE" -eq 201 ]]; then
        echo "✅ Role mapping configured successfully!"
        echo "Response: $BODY"
        return 0
    else
        echo "❌ Failed to configure role mapping (HTTP $HTTP_CODE):"
        echo "$BODY"
        return 1
    fi
}

# Main execution
if [[ "$VERIFY_ONLY" == "true" ]]; then
    verify_role_mapping
else
    if configure_role_mapping; then
        echo ""
        verify_role_mapping
    else
        exit 1
    fi
fi

echo ""
echo "============================================================"
echo "Configuration complete!"
echo "============================================================"