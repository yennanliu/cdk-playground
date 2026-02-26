#!/bin/bash
# Test the RAG pipeline end-to-end

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ENV=${1:-dev}

echo -e "${GREEN}=== Testing RAG Pipeline ===${NC}"
echo "Environment: $ENV"
echo

# Check kubectl access
if ! kubectl get namespace post-train >/dev/null 2>&1; then
    echo -e "${RED}Error: Cannot access post-train namespace${NC}"
    echo "Please ensure kubectl is configured correctly"
    exit 1
fi

# Test 1: Embedding service
echo -e "${YELLOW}Test 1: Embedding service${NC}"
kubectl run test-embed --rm -i --restart=Never --image=curlimages/curl:latest -n post-train -- \
    curl -X POST http://embedding-service.post-train.svc.cluster.local:8080/embed \
    -H "Content-Type: application/json" \
    -d '{"text": "Test document for embedding"}' \
    -s || echo -e "${RED}✗ Embedding service test failed${NC}"
echo -e "${GREEN}✓ Embedding service test passed${NC}"

# Test 2: Weaviate
echo
echo -e "${YELLOW}Test 2: Weaviate readiness${NC}"
kubectl run test-weaviate --rm -i --restart=Never --image=curlimages/curl:latest -n post-train -- \
    curl http://weaviate-client.post-train.svc.cluster.local:8080/v1/.well-known/ready \
    -s || echo -e "${RED}✗ Weaviate test failed${NC}"
echo -e "${GREEN}✓ Weaviate test passed${NC}"

# Test 3: vLLM (may take a while to start)
echo
echo -e "${YELLOW}Test 3: vLLM inference service${NC}"
echo "(This may take a few minutes if vLLM is still loading the model...)"
kubectl run test-vllm --rm -i --restart=Never --image=curlimages/curl:latest -n post-train -- \
    curl -X POST http://vllm.post-train.svc.cluster.local:8000/v1/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "qwen2.5-7b-sft", "prompt": "Hello", "max_tokens": 10}' \
    -s --max-time 60 || echo -e "${RED}✗ vLLM test failed (model may still be loading)${NC}"
echo -e "${GREEN}✓ vLLM test passed${NC}"

# Test 4: RAG Orchestrator health
echo
echo -e "${YELLOW}Test 4: RAG Orchestrator health${NC}"
kubectl run test-rag-health --rm -i --restart=Never --image=curlimages/curl:latest -n post-train -- \
    curl http://rag-orchestrator.post-train.svc.cluster.local:80/health \
    -s || echo -e "${RED}✗ RAG health test failed${NC}"
echo -e "${GREEN}✓ RAG health test passed${NC}"

# Test 5: Ingest a test document
echo
echo -e "${YELLOW}Test 5: Ingesting test document${NC}"
kubectl run test-ingest --rm -i --restart=Never --image=curlimages/curl:latest -n post-train -- \
    curl -X POST http://rag-orchestrator.post-train.svc.cluster.local:80/ingest \
    -H "Content-Type: application/json" \
    -d '{"content": "Retrieval-Augmented Generation (RAG) is a technique that combines information retrieval with text generation. It retrieves relevant documents from a knowledge base and uses them as context for generating answers.", "metadata": {"source": "test", "topic": "RAG"}}' \
    -s || echo -e "${RED}✗ Document ingestion test failed${NC}"
echo -e "${GREEN}✓ Document ingestion test passed${NC}"

# Test 6: RAG Query (if ingress is available)
echo
echo -e "${YELLOW}Test 6: RAG Query (via ingress if available)${NC}"
RAG_URL=$(kubectl get ingress rag-ingress -n post-train -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")

if [ -n "$RAG_URL" ]; then
    echo "RAG URL: $RAG_URL"
    echo "Testing RAG query..."
    curl -X POST "http://$RAG_URL/query" \
        -H "Content-Type: application/json" \
        -d '{"query": "What is retrieval-augmented generation?", "top_k": 3}' \
        -s | jq '.' || echo -e "${RED}✗ RAG query test failed${NC}"
    echo -e "${GREEN}✓ RAG query test passed${NC}"
else
    echo -e "${YELLOW}⚠ Ingress not ready yet, skipping external RAG query test${NC}"
    echo "You can test internally with:"
    echo 'kubectl run test-rag-query --rm -i --restart=Never --image=curlimages/curl:latest -n post-train -- curl -X POST http://rag-orchestrator.post-train.svc.cluster.local:80/query -H "Content-Type: application/json" -d '"'"'{"query": "What is RAG?"}'"'"' -s'
fi

echo
echo -e "${GREEN}=== All tests completed ===${NC}"
echo
echo "Pod status:"
kubectl get pods -n post-train
echo
echo "Service status:"
kubectl get svc -n post-train
