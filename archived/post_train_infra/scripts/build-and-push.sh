#!/bin/bash
# Build and push Docker images to ECR

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ENV=${1:-dev}
REGION=${2:-ap-northeast-1}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_BASE="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

echo -e "${GREEN}=== Building and pushing Docker images ===${NC}"
echo "Environment: $ENV"
echo "Region: $REGION"
echo "ECR Base: $ECR_BASE"
echo

# Login to ECR
echo -e "${YELLOW}Logging in to ECR...${NC}"
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_BASE
echo -e "${GREEN}✓ Logged in to ECR${NC}"

cd "$(dirname "$0")/.."

# Build and push training image
echo
echo -e "${YELLOW}Building training image...${NC}"
cd docker/training
TRAINING_REPO="$ECR_BASE/${ENV}-post-train/training"
docker build -t $TRAINING_REPO:latest .
docker push $TRAINING_REPO:latest
docker tag $TRAINING_REPO:latest $TRAINING_REPO:$(date +%Y%m%d-%H%M%S)
docker push $TRAINING_REPO:$(date +%Y%m%d-%H%M%S)
echo -e "${GREEN}✓ Training image pushed${NC}"

# Build and push embedding image
echo
echo -e "${YELLOW}Building embedding service image...${NC}"
cd ../embedding
EMBEDDING_REPO="$ECR_BASE/${ENV}-post-train/embedding"
docker build -t $EMBEDDING_REPO:latest .
docker push $EMBEDDING_REPO:latest
docker tag $EMBEDDING_REPO:latest $EMBEDDING_REPO:$(date +%Y%m%d-%H%M%S)
docker push $EMBEDDING_REPO:$(date +%Y%m%d-%H%M%S)
echo -e "${GREEN}✓ Embedding service image pushed${NC}"

# Build and push RAG orchestrator image
echo
echo -e "${YELLOW}Building RAG orchestrator image...${NC}"
cd ../rag-orchestrator
RAG_REPO="$ECR_BASE/${ENV}-post-train/rag-orchestrator"
docker build -t $RAG_REPO:latest .
docker push $RAG_REPO:latest
docker tag $RAG_REPO:latest $RAG_REPO:$(date +%Y%m%d-%H%M%S)
docker push $RAG_REPO:$(date +%Y%m%d-%H%M%S)
echo -e "${GREEN}✓ RAG orchestrator image pushed${NC}"

echo
echo -e "${GREEN}=== All images pushed successfully ===${NC}"
echo
echo "Images:"
echo "- Training: $TRAINING_REPO:latest"
echo "- Embedding: $EMBEDDING_REPO:latest"
echo "- RAG Orchestrator: $RAG_REPO:latest"
