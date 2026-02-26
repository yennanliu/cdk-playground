# Post-Training Infrastructure for Qwen2.5-7B with RAG

AWS CDK infrastructure for supervised fine-tuning (SFT) of Hugging Face Qwen2.5-7B model with Retrieval-Augmented Generation (RAG) capabilities using Weaviate vector database and vLLM inference server.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    CDK Stack: post-train-infra               │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  S3 Buckets  │  │   Secrets    │  │     ECR      │     │
│  │  - Training  │  │  - HF Token  │  │ Repositories │     │
│  │  - Models    │  │  - API Keys  │  │              │     │
│  │  - Checkpts  │  │              │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        Existing EKS Cluster (Terraform-managed)       │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │  Namespace: post-train                          │  │  │
│  │  │                                                  │  │  │
│  │  │  GPU Nodes (g4dn.xlarge):                       │  │  │
│  │  │  - Training Job (Kubernetes Job)                │  │  │
│  │  │  - vLLM Serving (Deployment)                    │  │  │
│  │  │                                                  │  │  │
│  │  │  CPU Nodes:                                      │  │  │
│  │  │  - Weaviate (StatefulSet + EFS)                 │  │  │
│  │  │  - Embedding Service (Deployment)               │  │  │
│  │  │  - RAG Orchestrator (Deployment + ALB Ingress)  │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Infrastructure (AWS CDK)
- **S3 Buckets**: Training data, model artifacts, checkpoints
- **Secrets Manager**: HuggingFace API token, Weaviate API keys
- **ECR Repositories**: Container images for training, inference, and RAG services
- **EFS**: Persistent storage for Weaviate vector database
- **IAM Roles**: IRSA roles for Kubernetes service accounts
- **CloudWatch**: Dashboards and alarms for monitoring

### Kubernetes Workloads
- **Training Job**: GPU-accelerated SFT for Qwen2.5-7B
- **vLLM**: Fast inference server with OpenAI-compatible API
- **Weaviate**: Vector database for document embeddings (3-replica HA cluster)
- **Embedding Service**: Sentence-transformers for text embeddings
- **RAG Orchestrator**: Coordinates retrieval and generation

## Prerequisites

- AWS CLI configured with appropriate credentials
- kubectl configured for EKS cluster access
- Node.js 18+ and npm
- Docker for building container images
- Existing EKS cluster with GPU node group (managed by Terraform)

## Quick Start

### 1. Bootstrap Infrastructure

```bash
# Deploy CDK stack
./scripts/bootstrap.sh <env> <region>

# Example:
./scripts/bootstrap.sh dev ap-northeast-1
```

You will be prompted for:
- **VPC ID**: Automatically detected from environment tag
- **EKS Cluster Name**: Defaults to `{env}-kubernetes-cluster`
- **kubectl Role ARN**: IAM role for EKS cluster management

### 2. Update Secrets

Update the HuggingFace token in AWS Secrets Manager:

```bash
aws secretsmanager put-secret-value \
    --secret-id dev-post-train/huggingface-token \
    --secret-string '{"token":"hf_xxxxxxxxxxxxx"}'
```

### 3. Build and Push Docker Images

```bash
./scripts/build-and-push.sh dev ap-northeast-1
```

This builds and pushes:
- Training container (PyTorch + Transformers + DeepSpeed)
- Embedding service (sentence-transformers)
- RAG orchestrator (FastAPI)

### 4. Upload Training Data

```bash
# Upload JSONL training data
./scripts/upload-training-data.sh dev ./data/train.jsonl

# Process and move to processed directory
aws s3 cp s3://dev-post-train-data/raw/train.jsonl \
    s3://dev-post-train-data/processed/train.jsonl
```

**Training Data Format** (JSONL):
```json
{"text": "Instruction: ...\nResponse: ..."}
{"text": "Instruction: ...\nResponse: ..."}
```

### 5. Submit Training Job

```bash
# Get the training job template
kubectl get configmap training-job-template -n post-train -o jsonpath='{.data.job-template\.yaml}' > job.yaml

# Replace TIMESTAMP placeholder
sed "s/TIMESTAMP/$(date +%s)/g" job.yaml | kubectl apply -f -

# Monitor training
kubectl logs -f job/qwen2-5-7b-sft-<timestamp> -n post-train
```

### 6. Deploy Inference and RAG Services

The vLLM, Weaviate, embedding service, and RAG orchestrator are automatically deployed by the CDK stack. Wait for pods to be ready:

```bash
kubectl get pods -n post-train -w
```

### 7. Test RAG Pipeline

```bash
./scripts/test-rag-pipeline.sh dev
```

## Usage

### Ingest Documents

```bash
# Get RAG orchestrator URL
RAG_URL=$(kubectl get ingress rag-ingress -n post-train -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

# Ingest a document
curl -X POST "http://$RAG_URL/ingest" \
    -H "Content-Type: application/json" \
    -d '{
        "content": "Your document content here...",
        "metadata": {"source": "doc1", "topic": "AI"}
    }'
```

### Query RAG API

```bash
curl -X POST "http://$RAG_URL/query" \
    -H "Content-Type: application/json" \
    -d '{
        "query": "What is supervised fine-tuning?",
        "top_k": 5,
        "max_tokens": 512,
        "temperature": 0.7
    }' | jq '.'
```

### Direct vLLM Inference

```bash
kubectl port-forward svc/vllm 8000:8000 -n post-train

curl -X POST http://localhost:8000/v1/completions \
    -H "Content-Type: application/json" \
    -d '{
        "model": "qwen2.5-7b-sft",
        "prompt": "Explain machine learning in simple terms:",
        "max_tokens": 256
    }' | jq '.'
```

## Monitoring

### CloudWatch Dashboard

View metrics and alarms in CloudWatch:

```bash
# Get dashboard URL from CDK outputs
aws cloudformation describe-stacks \
    --stack-name post-train-infra-dev \
    --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' \
    --output text
```

Dashboard includes:
- GPU utilization and memory
- vLLM request latency (P50/P90/P99)
- Training loss and progress
- RAG query performance
- Error rates

### Logs

```bash
# Training logs
kubectl logs -f job/<training-job-name> -n post-train

# vLLM logs
kubectl logs -f deployment/vllm -n post-train

# Weaviate logs
kubectl logs -f statefulset/weaviate -n post-train

# RAG orchestrator logs
kubectl logs -f deployment/rag-orchestrator -n post-train
```

## Configuration

### Training Hyperparameters

Edit the `training-config` ConfigMap:

```bash
kubectl edit configmap training-config -n post-train
```

Default values:
- `NUM_TRAIN_EPOCHS`: 3
- `PER_DEVICE_TRAIN_BATCH_SIZE`: 4
- `GRADIENT_ACCUMULATION_STEPS`: 4
- `LEARNING_RATE`: 2e-5
- `MAX_SEQ_LENGTH`: 2048

### Scaling

```bash
# Scale vLLM replicas
kubectl scale deployment vllm --replicas=2 -n post-train

# Scale Weaviate replicas (HA)
kubectl scale statefulset weaviate --replicas=5 -n post-train

# Scale RAG orchestrator
kubectl scale deployment rag-orchestrator --replicas=5 -n post-train
```

## Cost Optimization

**Estimated Monthly Costs (Dev Environment):**
- GPU nodes (training 8h/week + inference 24/7): ~$397
- CPU nodes (Weaviate, Embedding, RAG): ~$120
- EFS (100GB): ~$30
- S3 (500GB): ~$12
- **Total**: ~$559/month

**Optimization Strategies:**
1. Use Spot instances for training (70% savings)
2. Scale vLLM to zero in dev (KEDA + HPA)
3. S3 lifecycle policies (Glacier after 90 days)
4. Reserved instances for production inference

## Troubleshooting

### Training Job Fails

```bash
# Check job logs
kubectl logs job/<job-name> -n post-train

# Check GPU availability
kubectl describe node -l workload-type=gpu

# Verify S3 access
kubectl run -it --rm aws-cli --image=amazon/aws-cli --restart=Never -n post-train -- s3 ls s3://dev-post-train-data/
```

### vLLM Not Ready

```bash
# Check pod status
kubectl describe pod -l app=vllm -n post-train

# Check if model exists in S3
aws s3 ls s3://dev-post-train-models/qwen2.5-7b-sft-latest/

# Increase readiness probe timeout if model loading is slow
kubectl patch deployment vllm -n post-train --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/readinessProbe/initialDelaySeconds", "value": 300}]'
```

### Weaviate Issues

```bash
# Check StatefulSet status
kubectl get statefulset weaviate -n post-train

# Check EFS mounting
kubectl describe pod weaviate-0 -n post-train | grep -A 5 "Volumes"

# Access Weaviate UI (if enabled)
kubectl port-forward svc/weaviate-client 8080:8080 -n post-train
# Open http://localhost:8080
```

## Development

### Local Testing

```bash
# Build images locally
cd docker/training && docker build -t training:local .
cd docker/embedding && docker build -t embedding:local .
cd docker/rag-orchestrator && docker build -t rag:local .

# Run locally
docker run -p 8080:8080 -e MODEL_NAME=sentence-transformers/all-MiniLM-L6-v2 embedding:local
```

### CDK Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Synthesize CloudFormation
npx cdk synth -c env=dev

# Diff changes
npx cdk diff -c env=dev

# Deploy
npx cdk deploy -c env=dev
```

## Security

- **IRSA**: IAM roles for service accounts (no hardcoded credentials)
- **Secrets Manager**: Encrypted storage for sensitive data
- **VPC**: All workloads run in private subnets
- **HTTPS**: ALB with TLS 1.3/1.2 for RAG API
- **S3**: Server-side encryption at rest
- **EFS**: Encrypted at rest and in transit

## Clean Up

```bash
# Delete CDK stack (keeps S3 buckets with data)
npx cdk destroy -c env=dev

# Delete S3 buckets (if needed)
aws s3 rb s3://dev-post-train-data --force
aws s3 rb s3://dev-post-train-models --force
aws s3 rb s3://dev-post-train-checkpoints --force

# Delete ECR images
aws ecr batch-delete-image --repository-name dev-post-train/training --image-ids imageTag=latest
aws ecr batch-delete-image --repository-name dev-post-train/embedding --image-ids imageTag=latest
aws ecr batch-delete-image --repository-name dev-post-train/rag-orchestrator --image-ids imageTag=latest
```

## Contributing

See project root `CLAUDE.md` for development guidelines.

## License

Proprietary - Jericho Security

## Support

For issues or questions, please contact the infrastructure team or file an issue in the repository.
