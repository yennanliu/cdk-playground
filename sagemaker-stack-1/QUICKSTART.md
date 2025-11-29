# Quick Start Guide

## Prerequisites

```bash
# Install uv (Python package manager)
brew install uv

# Install AWS CDK
npm install -g aws-cdk

# Configure AWS CLI
aws configure
```

## Deployment (5 Steps)

### 1. Setup Python Environment (One-time)

```bash
./scripts/setup-python-env.sh
```

This creates an isolated `.venv` with Python 3.10 and all dependencies.

### 2. Train and Package Model

```bash
./scripts/train-and-package-model.sh
```

Creates `model/build/model.tar.gz`.

### 3. Install Node Dependencies

```bash
npm install
cd lambda && npm install && cd ..
```

### 4. Build and Deploy

```bash
npm run build
cdk bootstrap  # First time only
cdk deploy
```

**Save the outputs:**
- ModelBucketName
- PredictEndpoint

### 5. Upload Model

```bash
# Replace with your bucket name from outputs
aws s3 cp model/build/model.tar.gz s3://sagemaker-house-price-model-YOUR_ACCOUNT_ID/model.tar.gz
```

## Testing

```bash
# Replace with your API URL from outputs
curl -X POST https://YOUR_API.execute-api.ap-northeast-1.amazonaws.com/prod/predict \
  -H "Content-Type: application/json" \
  -d '{
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2000,
    "year_built": 2015
  }'
```

Or use the test script:
```bash
./scripts/test-api.sh https://YOUR_API.../prod/predict
```

## Clean Up

```bash
cdk destroy
```

## Troubleshooting

**Python environment issues:**
```bash
rm -rf .venv
./scripts/setup-python-env.sh
```

**Lambda build fails:**
```bash
cd lambda
rm -rf node_modules
npm install
cd ..
```

**Model not found:**
```bash
# Verify upload
aws s3 ls s3://sagemaker-house-price-model-YOUR_ACCOUNT_ID/

# Re-upload
aws s3 cp model/build/model.tar.gz s3://sagemaker-house-price-model-YOUR_ACCOUNT_ID/model.tar.gz
```

## Cost

**~$50-60/month** while running (mostly SageMaker endpoint)

Run `cdk destroy` to stop charges.

## Documentation

- **DEPLOYMENT.md** - Detailed deployment guide
- **docs/UV_SETUP.md** - Python environment details
- **docs/IMPLEMENTATION_SUMMARY.md** - Complete implementation overview
