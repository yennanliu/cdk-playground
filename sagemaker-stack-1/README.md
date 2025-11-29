# SageMaker ML API - House Price Prediction

A simple, production-ready ML API built with AWS SageMaker, Lambda, and API Gateway. This project demonstrates how to deploy a scikit-learn machine learning model as a serverless REST API on AWS.

## What This Stack Does

This CDK stack creates a complete ML inference infrastructure that:

1. **Trains a simple ML model** (sklearn Linear Regression) on synthetic house price data
2. **Deploys the model to SageMaker** as a real-time inference endpoint
3. **Exposes a REST API** via API Gateway that accepts house features and returns price predictions
4. **Handles all infrastructure** as code using AWS CDK (TypeScript)

**Use Case**: Given house attributes (bedrooms, bathrooms, square footage, year built), predict the house price in USD.

## Architecture Overview

```
┌─────────────┐
│   Client    │
│ (curl/web)  │
└──────┬──────┘
       │ POST /predict
       │ {"bedrooms": 3, "bathrooms": 2, ...}
       ▼
┌──────────────────┐
│  API Gateway     │  REST API (CORS enabled)
│  (ap-northeast-1)│
└──────┬───────────┘
       │ Lambda Integration
       ▼
┌──────────────────┐
│  Lambda Function │  - Input validation
│  (Node.js 20)    │  - SageMaker invocation
│                  │  - Error handling
└──────┬───────────┘
       │ SageMaker Runtime SDK
       ▼
┌─────────────────────┐
│ SageMaker Endpoint  │  ml.t2.medium instance
│ (house-price-       │  Always running (InService)
│  predictor)         │  <100ms latency
└──────┬──────────────┘
       │ Loads model at startup
       ▼
┌──────────────────┐
│  S3 Bucket       │  model.tar.gz contains:
│                  │  - model.joblib (trained model)
│                  │  - inference.py (handler)
│                  │  - requirements.txt
└──────────────────┘
```

## Stack Components

### ML Model Layer
- **Model**: Scikit-learn Linear Regression (trained on 200 samples)
- **Features**: bedrooms, bathrooms, sqft, year_built
- **Training**: Local training with `uv` virtual environment
- **Packaging**: model.tar.gz with SageMaker inference handler

### Infrastructure Layer (CDK)
- **S3 Bucket**: Stores model artifacts (versioned, auto-delete on destroy)
- **SageMaker Model**: References sklearn container + S3 model
- **SageMaker Endpoint Config**: ml.t2.medium, 1 instance
- **SageMaker Endpoint**: Always-on inference endpoint
- **Lambda Function**: API request handler (30s timeout)
- **API Gateway**: REST API with CORS (prod stage)
- **IAM Roles**: Least-privilege permissions

### Python Environment
- **uv**: Modern Python package manager (10-100x faster than pip)
- **Virtual Environment**: Isolated `.venv` directory (Python 3.10)
- **No System Python**: All dependencies in project-specific environment

## Key Features

✅ **Infrastructure as Code** - Everything defined in CDK TypeScript
✅ **Isolated Python Env** - Uses `uv` for fast, reproducible builds
✅ **Real-time Inference** - <100ms prediction latency
✅ **Serverless API** - Auto-scaling Lambda + API Gateway
✅ **Production Ready** - Error handling, logging, CORS support
✅ **Cost Optimized** - ml.t2.medium (~$50/month, destroy when not needed)
✅ **Easy Testing** - Includes test scripts and sample data

## Quick Start

### Prerequisites
```bash
# Install uv (Python package manager)
brew install uv  # macOS
# or: curl -LsSf https://astral.sh/uv/install.sh | sh

# Install AWS CDK
npm install -g aws-cdk

# Configure AWS credentials
aws configure
```

### Deployment Steps

#### 1. Setup Python Environment (one-time)
```bash
./scripts/setup-python-env.sh
```
Creates isolated `.venv` with Python 3.10 and all ML dependencies.

#### 2. Train and Package Model
```bash
./scripts/train-and-package-model.sh
```
Trains sklearn model and creates `model/build/model.tar.gz`.

#### 3. Install Node Dependencies
```bash
npm install
cd lambda && npm install && cd ..
```

#### 4. Build and Deploy Infrastructure
```bash
npm run build
cdk bootstrap  # First time only
cdk deploy
```

**Save the outputs:**
- `ModelBucketName` (e.g., sagemaker-house-price-model-123456789012)
- `PredictEndpoint` (e.g., https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/predict)

#### 5. Upload Model to S3
```bash
# Use the bucket name from CDK outputs
aws s3 cp model/build/model.tar.gz \
  s3://sagemaker-house-price-model-YOUR_ACCOUNT_ID/model.tar.gz
```

#### 6. Test the API
```bash
# Use the PredictEndpoint URL from CDK outputs
curl -X POST https://YOUR-API-URL/prod/predict \
  -H "Content-Type: application/json" \
  -d '{
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2000,
    "year_built": 2015
  }'
```

**Expected Response:**
```json
{
  "predicted_price": 385000,
  "model_version": "v1",
  "input": {...},
  "timestamp": "2025-11-29T18:00:00.000Z"
}
```

Or use the test script:
```bash
./scripts/test-api.sh https://YOUR-API-URL/prod/predict
```

## Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** - Quick reference card
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment guide with troubleshooting
- **[docs/UV_SETUP.md](./docs/UV_SETUP.md)** - Python environment details with uv
- **[docs/ml-api-implementation-plan.md](./docs/ml-api-implementation-plan.md)** - Detailed implementation plan
- **[docs/IMPLEMENTATION_SUMMARY.md](./docs/IMPLEMENTATION_SUMMARY.md)** - What was implemented

## Project Structure

```
sagemaker-stack-1/
├── .python-version              # Python 3.10 specification
├── .venv/                       # Virtual environment (gitignored)
├── bin/
│   └── sagemaker-stack-1.ts    # CDK app entry point
├── lib/
│   └── sagemaker-stack-1-stack.ts  # CDK stack definition
├── lambda/
│   ├── predict-handler.ts      # API Gateway handler
│   ├── package.json
│   └── tsconfig.json
├── model/
│   ├── data/
│   │   └── house_data.csv      # Training data (200 samples)
│   ├── train.py                # Model training script
│   ├── inference.py            # SageMaker inference handler
│   ├── requirements.txt        # Python dependencies
│   └── build/
│       └── model.tar.gz        # Packaged model (generated)
├── scripts/
│   ├── setup-python-env.sh     # Setup isolated Python env
│   ├── train-and-package-model.sh  # Train and package
│   └── test-api.sh             # API testing script
└── docs/
    ├── ml-api-implementation-plan.md
    ├── IMPLEMENTATION_SUMMARY.md
    └── UV_SETUP.md
```

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Infrastructure** | AWS CDK | 2.202.0 | Infrastructure as Code |
| **API** | API Gateway | REST API | HTTP endpoint |
| **Compute** | Lambda | Node.js 20 | Request handling |
| **ML Inference** | SageMaker | ml.t2.medium | Model hosting |
| **ML Model** | scikit-learn | 1.3.2 | Linear Regression |
| **Container** | AWS DLC | sklearn-inference:1.2-1 | Pre-built ML container |
| **Storage** | S3 | - | Model artifacts |
| **Python Env** | uv | latest | Package management |
| **Region** | AWS | ap-northeast-1 | Tokyo |

## Cost Breakdown

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| **SageMaker Endpoint** | ml.t2.medium (24/7) | ~$50 |
| Lambda | 1000 invocations | ~$0.20 |
| API Gateway | 1000 requests | ~$0.04 |
| S3 | 1 GB storage | ~$0.02 |
| CloudWatch Logs | Standard logging | ~$0.50 |
| **Total** | | **~$50-60/month** |

**Cost-saving tip**: Run `cdk destroy` when not testing to avoid charges.

## Monitoring

### Check Endpoint Status
```bash
aws sagemaker describe-endpoint \
  --endpoint-name house-price-predictor \
  --region ap-northeast-1 \
  --query 'EndpointStatus'
```

### View Lambda Logs
```bash
aws logs tail /aws/lambda/SagemakerStack1Stack-PredictHandler \
  --follow --region ap-northeast-1
```

### View SageMaker Logs
```bash
aws logs tail /aws/sagemaker/Endpoints/house-price-predictor \
  --follow --region ap-northeast-1
```

## Troubleshooting

### Python Environment Issues
```bash
rm -rf .venv
./scripts/setup-python-env.sh
```

### Model Not Found
```bash
# Verify S3 upload
aws s3 ls s3://sagemaker-house-price-model-YOUR_ACCOUNT_ID/

# Re-upload
aws s3 cp model/build/model.tar.gz \
  s3://sagemaker-house-price-model-YOUR_ACCOUNT_ID/model.tar.gz
```

### Endpoint Not Ready
```bash
# Check status (wait for InService)
aws sagemaker describe-endpoint \
  --endpoint-name house-price-predictor \
  --region ap-northeast-1
```

## Clean Up

```bash
# Destroy all resources
cdk destroy

# Confirm with 'y'
```

This will delete:
- SageMaker endpoint (stops billing)
- Lambda function
- API Gateway
- S3 bucket and contents
- IAM roles

## Useful Commands

| Command | Description |
|---------|-------------|
| `./scripts/setup-python-env.sh` | Setup Python environment |
| `./scripts/train-and-package-model.sh` | Train and package model |
| `npm run build` | Compile TypeScript |
| `cdk diff` | Show infrastructure changes |
| `cdk deploy` | Deploy stack |
| `cdk destroy` | Delete all resources |
| `./scripts/test-api.sh <URL>` | Test deployed API |
| `source .venv/bin/activate` | Manually activate Python env |

## References

- [AWS SageMaker Documentation](https://docs.aws.amazon.com/sagemaker/)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [uv Documentation](https://docs.astral.sh/uv/)
- [AWS Deep Learning Containers](https://github.com/aws/deep-learning-containers)
- [SageMaker Examples](https://github.com/aws/amazon-sagemaker-examples)