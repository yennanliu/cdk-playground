# SageMaker ML API - House Price Prediction

A simple, production-ready ML API built with AWS SageMaker, Lambda, and API Gateway. This project demonstrates how to deploy a scikit-learn machine learning model as a serverless REST API on AWS.

## Overview

This project implements a house price prediction service using:
- **ML Model**: Scikit-learn Linear Regression
- **Inference**: AWS SageMaker real-time endpoint
- **API Layer**: Lambda + API Gateway
- **Infrastructure**: AWS CDK (TypeScript)
- **Region**: ap-northeast-1 (Tokyo)

## Quick Start

### 1. Setup Python Environment
```bash
./scripts/setup-python-env.sh
```

### 2. Train and Package Model
```bash
./scripts/train-and-package-model.sh
```

### 3. Deploy Infrastructure
```bash
npm install
cd lambda && npm install && cd ..
npm run build
cdk deploy
```

### 4. Upload Model to S3
```bash
aws s3 cp model/build/model.tar.gz s3://sagemaker-house-price-model-YOUR_ACCOUNT_ID/model.tar.gz
```

### 5. Test API
```bash
curl -X POST https://YOUR-API-URL/prod/predict \
  -H "Content-Type: application/json" \
  -d '{
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2000,
    "year_built": 2015
  }'
```

## Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment guide with troubleshooting
- **[docs/ml-api-implementation-plan.md](./docs/ml-api-implementation-plan.md)** - Detailed implementation plan and architecture

## Project Structure

```
├── lib/                           # CDK infrastructure code
├── lambda/                        # API handler function
├── model/                         # ML model training and inference
│   ├── data/house_data.csv       # Training data
│   ├── train.py                  # Training script
│   └── inference.py              # SageMaker inference handler
└── scripts/                       # Helper scripts
```

## Architecture

```
Client → API Gateway → Lambda → SageMaker Endpoint → sklearn Model
                                       ↓
                                 S3 (model.tar.gz)
```

## Cost

**~$50-60/month** for development (mostly SageMaker endpoint on ml.t2.medium)

Run `cdk destroy` when not in use to avoid charges.

## Requirements

- AWS CLI configured
- Node.js 20+
- **uv** (Python package manager) - Automatically installs Python 3.10
- AWS CDK CLI

### Installing uv
```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# macOS with Homebrew
brew install uv
```

## Useful Commands

* `npm run build` - Compile TypeScript
* `cdk deploy` - Deploy stack
* `cdk destroy` - Clean up resources
* `./scripts/test-api.sh <API_URL>` - Test the deployed API



## Ref

- https://github.com/aws/amazon-sagemaker-examples/blob/main/sagemaker-python-sdk/pytorch_mnist/pytorch_mnist.ipynb