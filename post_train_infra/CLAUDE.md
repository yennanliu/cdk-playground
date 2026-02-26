# CLAUDE.md - Post-Training Infrastructure Stack

This file provides guidance to Claude Code when working with the post-training infrastructure for Qwen2.5-7B with RAG.

## Stack Overview

This is an AWS CDK stack (TypeScript) that provisions infrastructure for:
- **Model Training**: Supervised fine-tuning of Qwen2.5-7B on EKS GPU nodes
- **Model Serving**: vLLM inference server on GPU nodes
- **Vector Database**: Weaviate cluster with EFS persistence
- **RAG Pipeline**: Embedding service + RAG orchestrator with ALB ingress

## Key Design Decisions

1. **Standalone CDK Stack**: Separate from main infrastructure for independent ML lifecycle management
2. **Imports Existing Resources**: Imports Terraform-managed EKS cluster and VPC (does not create them)
3. **IRSA for Security**: IAM Roles for Service Accounts (no hardcoded credentials)
4. **EFS for Weaviate**: Multi-AZ support for HA vector database
5. **GPU Node Reuse**: Shares GPU nodes with existing workloads (DFDet) via tolerations and affinity

## Directory Structure

```
post_train_infra/
├── bin/post-train-stack.ts          # CDK app entry point
├── lib/
│   ├── post-train-stack.ts          # Main stack definition
│   ├── constructs/                  # Reusable CDK constructs
│   │   ├── storage/                 # S3 buckets
│   │   ├── iam/                     # IRSA roles
│   │   ├── secrets/                 # Secrets Manager
│   │   ├── container/               # ECR repositories
│   │   ├── vector-db/               # EFS for Weaviate
│   │   ├── monitoring/              # CloudWatch dashboard
│   │   └── kubernetes/              # K8s manifests
│   └── config/                      # Configuration files
├── docker/                          # Docker images
│   ├── training/                    # Training container
│   ├── embedding/                   # Embedding service
│   └── rag-orchestrator/            # RAG API
├── k8s/templates/                   # K8s manifest templates
├── scripts/                         # Deployment scripts
└── test/                            # CDK tests
```

## Important Files and Their Purpose

### CDK Stack Files
- `bin/post-train-stack.ts`: CDK app entry, reads environment context
- `lib/post-train-stack.ts`: Main stack orchestrator, imports EKS cluster
- `lib/constructs/iam/pod-execution-role.ts`: IRSA roles for 4 service accounts
- `lib/constructs/kubernetes/namespace.ts`: Creates post-train namespace and service accounts

### Kubernetes Manifests
- `lib/constructs/kubernetes/training-job-manifest.ts`: GPU training job template
- `lib/constructs/kubernetes/vllm-deployment-manifest.ts`: vLLM inference deployment
- `lib/constructs/kubernetes/weaviate-statefulset-manifest.ts`: Weaviate HA cluster
- `lib/constructs/kubernetes/embedding-deployment-manifest.ts`: Embedding service
- `lib/constructs/kubernetes/rag-orchestrator-manifest.ts`: RAG API with ALB ingress

### Docker Applications
- `docker/training/train_sft.py`: Supervised fine-tuning script for Qwen2.5-7B
- `docker/embedding/app.py`: FastAPI embedding service (sentence-transformers)
- `docker/rag-orchestrator/app.py`: FastAPI RAG orchestrator

## Common Tasks

### Deploying the Stack

```bash
# Deploy to dev environment
npx cdk deploy -c env=dev -c vpcId=vpc-xxx -c clusterName=dev-kubernetes-cluster -c kubectlRoleArn=arn:aws:iam::xxx

# Synthesize CloudFormation
npx cdk synth -c env=dev

# View diff before deploy
npx cdk diff -c env=dev
```

### Building Docker Images

```bash
# Build all images
./scripts/build-and-push.sh dev ap-northeast-1

# Build individual image
cd docker/training
docker build -t <account>.dkr.ecr.ap-northeast-1.amazonaws.com/dev-post-train/training:latest .
docker push <account>.dkr.ecr.ap-northeast-1.amazonaws.com/dev-post-train/training:latest
```

### Kubernetes Operations

```bash
# Check namespace resources
kubectl get all -n post-train

# Submit training job
kubectl create job qwen2-5-7b-sft-$(date +%s) --from=cronjob/training-job-template -n post-train

# Scale deployments
kubectl scale deployment vllm --replicas=2 -n post-train

# Check logs
kubectl logs -f deployment/rag-orchestrator -n post-train
```

## GPU Resource Configuration

### Training Job
- **GPU**: 1x NVIDIA T4 (via `nvidia.com/gpu: "1"`)
- **Tolerations**: `nvidia.com/gpu=true:NoSchedule`
- **Node Affinity**: `workload-type=gpu`
- **Resources**: 32Gi RAM, 8 CPU, 1 GPU
- **Shared Memory**: 8Gi `/dev/shm` for DataLoader
- **Pattern**: Matches `terraform/aws/dfdet-deployment.tf`

### vLLM Inference
- **GPU**: 1x NVIDIA T4
- **Resources**: 12Gi RAM, 4 CPU, 1 GPU
- **Replicas**: 1 (scale based on load)
- **Probes**: Readiness 120s initial delay (model loading)

## IRSA Roles and Permissions

Four service accounts with IRSA:

1. **post-train-sa** (Training)
   - S3: Read/Write to data, models, checkpoints buckets
   - Secrets Manager: Read HuggingFace token
   - CloudWatch Logs: Write
   - ECR: Pull images

2. **vllm-sa** (Inference)
   - S3: Read models bucket
   - CloudWatch Logs: Write
   - ECR: Pull images

3. **weaviate-sa** (Vector DB)
   - CloudWatch Logs: Write
   - ECR: Pull images

4. **rag-sa** (RAG & Embedding)
   - Secrets Manager: Read Weaviate API key
   - CloudWatch Logs: Write
   - ECR: Pull images

## Monitoring

### CloudWatch Dashboard
Located at: `lib/constructs/monitoring/cloudwatch-dashboard.ts`

Metrics tracked:
- GPU utilization and memory (ContainerInsights)
- vLLM request latency (P50/P90/P99)
- Training loss and progress (custom metrics)
- RAG query performance
- Error rates per service

### Alarms
- Training job failures
- GPU OOM (>95% memory)
- vLLM high latency (P99 > 5s)
- RAG high error rate (>10 errors/5min)
- Weaviate unavailable (<1 pod)

## Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
./scripts/test-rag-pipeline.sh dev
```

Tests:
1. Embedding service health
2. Weaviate readiness
3. vLLM inference
4. RAG orchestrator health
5. Document ingestion
6. End-to-end RAG query

## Code Review Guidelines

When reviewing changes to this stack:

### Infrastructure (CDK)
- Verify IRSA roles follow least privilege principle
- Check that GPU tolerations and affinity match existing patterns (DFDet)
- Ensure removal policies are appropriate for environment (RETAIN for prod)
- Validate CloudWatch alarms have proper thresholds
- Confirm S3 lifecycle policies are cost-effective

### Kubernetes Manifests
- GPU resource requests match limits (no overcommit)
- Readiness probes allow sufficient model loading time (120s+ for vLLM)
- Service accounts are correctly annotated with IAM role ARNs
- PersistentVolumeClaims use correct StorageClass (efs-sc)
- Node affinity and tolerations match GPU node configuration

### Docker Applications
- Training script handles S3 uploads correctly
- Embedding service uses CPU-only mode
- RAG orchestrator has proper error handling for service calls
- Health check endpoints are implemented
- Timeouts are appropriate for long-running operations

### Security
- No hardcoded credentials in code or env vars
- All secrets use AWS Secrets Manager
- IRSA is used instead of instance profiles
- ALB ingress uses HTTPS with TLS 1.3/1.2
- S3 buckets have encryption enabled

## Troubleshooting Common Issues

### CDK Deploy Fails with "Cluster not found"
- Ensure VPC ID and cluster name are correct
- Verify kubectl role ARN has permissions to manage EKS cluster
- Check that EKS cluster OIDC provider is configured

### Training Job Stuck in Pending
- Check GPU node availability: `kubectl describe node -l workload-type=gpu`
- Verify tolerations match node taints
- Check resource requests don't exceed node capacity

### vLLM Pod CrashLoopBackOff
- Check if model exists in S3: `aws s3 ls s3://dev-post-train-models/`
- Verify IRSA role has S3 read permissions
- Check GPU allocation: `kubectl describe pod -l app=vllm -n post-train`
- Review logs: `kubectl logs -f deployment/vllm -n post-train`

### Weaviate Data Loss
- Check EFS mount: `kubectl describe pvc weaviate-data-pvc -n post-train`
- Verify EFS access point is configured correctly
- Check StatefulSet volumeClaimTemplates

### RAG Query Failures
- Verify all services are healthy: `kubectl get pods -n post-train`
- Check service connectivity: `kubectl run test-curl --rm -i --restart=Never --image=curlimages/curl -n post-train -- curl http://weaviate-client:8080/v1/.well-known/ready`
- Review orchestrator logs for upstream errors

## Cost Management

### Dev Environment
- Use Spot instances for training (set in Terraform)
- Scale vLLM to 0 replicas when not in use
- Set S3 lifecycle policies (already configured)

### Production Environment
- Use Reserved Instances for inference nodes
- Enable S3 Intelligent-Tiering
- Set CloudWatch Logs retention to 30 days
- Monitor unused resources with AWS Cost Explorer

## Related Files

### Terraform (Existing Infrastructure)
- `terraform/aws/eks.tf`: EKS cluster definition
- `terraform/aws/eks-gpu-nodegroup.tf`: GPU node group configuration
- `terraform/aws/dfdet-deployment.tf`: Reference GPU deployment pattern

## Notes for Claude

- This stack **imports** an existing EKS cluster; it does not create one
- GPU node configuration must match Terraform-managed node group
- Training job is submitted manually via kubectl, not deployed by CDK
- vLLM uses official Docker image; custom build is optional
- Weaviate schema is auto-created on first RAG orchestrator startup
- ALB ingress requires AWS Load Balancer Controller to be installed on cluster
- Model artifacts must be manually copied to S3 with "latest" symlink for vLLM
