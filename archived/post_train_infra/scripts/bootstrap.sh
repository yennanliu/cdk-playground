#!/bin/bash
# Bootstrap script for post-training infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ENV=${1:-dev}
REGION=${2:-ap-northeast-1}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo -e "${GREEN}=== Bootstrapping Post-Train Infrastructure ===${NC}"
echo "Environment: $ENV"
echo "Region: $REGION"
echo "Account: $ACCOUNT_ID"
echo

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"
command -v npm >/dev/null 2>&1 || { echo -e "${RED}npm is required but not installed.${NC}" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo -e "${RED}AWS CLI is required but not installed.${NC}" >&2; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo -e "${RED}kubectl is required but not installed.${NC}" >&2; exit 1; }
echo -e "${GREEN}✓ All prerequisites met${NC}"

# Get VPC ID and EKS cluster name
echo
echo -e "${YELLOW}Getting infrastructure details...${NC}"
VPC_ID=$(aws ec2 describe-vpcs --region $REGION --filters "Name=tag:Environment,Values=$ENV" --query 'Vpcs[0].VpcId' --output text)
CLUSTER_NAME="${ENV}-kubernetes-cluster"

if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
    echo -e "${RED}Error: Could not find VPC for environment $ENV${NC}"
    exit 1
fi

echo "VPC ID: $VPC_ID"
echo "Cluster Name: $CLUSTER_NAME"

# Get kubectl role ARN (you need to provide this)
echo
echo -e "${YELLOW}Please provide the kubectl role ARN:${NC}"
echo "This is typically the IAM role used to manage the EKS cluster"
read -p "kubectl Role ARN: " KUBECTL_ROLE_ARN

# Install CDK dependencies
echo
echo -e "${YELLOW}Installing CDK dependencies...${NC}"
cd "$(dirname "$0")/.."
npm install

# Build TypeScript
echo
echo -e "${YELLOW}Building TypeScript...${NC}"
npm run build

# Bootstrap CDK if needed
echo
echo -e "${YELLOW}Checking CDK bootstrap...${NC}"
if ! aws cloudformation describe-stacks --region $REGION --stack-name CDKToolkit >/dev/null 2>&1; then
    echo "CDK not bootstrapped. Bootstrapping now..."
    npx cdk bootstrap "aws://$ACCOUNT_ID/$REGION"
else
    echo -e "${GREEN}✓ CDK already bootstrapped${NC}"
fi

# Deploy CDK stack
echo
echo -e "${YELLOW}Deploying CDK stack...${NC}"
npx cdk deploy \
    -c env=$ENV \
    -c region=$REGION \
    -c vpcId=$VPC_ID \
    -c clusterName=$CLUSTER_NAME \
    -c kubectlRoleArn=$KUBECTL_ROLE_ARN \
    --require-approval never

echo
echo -e "${GREEN}=== Bootstrap complete ===${NC}"
echo
echo "Next steps:"
echo "1. Update HuggingFace token in AWS Secrets Manager: ${ENV}-post-train/huggingface-token"
echo "2. Build and push Docker images: ./scripts/build-and-push.sh $ENV $REGION"
echo "3. Upload training data: ./scripts/upload-training-data.sh $ENV <data-path>"
echo "4. Submit training job (see README.md)"
echo "5. Test RAG pipeline: ./scripts/test-rag-pipeline.sh $ENV"
