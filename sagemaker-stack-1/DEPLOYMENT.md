# Deployment Guide: SageMaker ML API

This guide walks you through deploying a simple house price prediction ML API using AWS SageMaker.

## Prerequisites

- AWS CLI configured with credentials
- Node.js 20+ and npm installed
- **uv** (Python package manager) - https://docs.astral.sh/uv/
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- AWS account with permissions for SageMaker, Lambda, API Gateway, S3, IAM

### Installing uv

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# macOS with Homebrew
brew install uv

# Verify installation
uv --version
```

**Note**: `uv` will automatically install the correct Python version (3.10) for this project.

## Architecture

```
Client → API Gateway → Lambda → SageMaker Endpoint → ML Model (sklearn)
                                       ↓
                                  S3 (model.tar.gz)
```

## Step-by-Step Deployment

### 1. Setup Python Environment

```bash
# This will:
# - Install uv (if not already installed)
# - Install Python 3.10
# - Create a virtual environment at .venv
# - Install all Python dependencies
./scripts/setup-python-env.sh
```

Expected output:
```
✓ uv is installed
✓ Python 3.10 installed
✓ Virtual environment created at .venv
✓ Dependencies installed
```

### 2. Install Node.js Dependencies

```bash
# Install CDK dependencies
npm install

# Install Lambda dependencies and build
cd lambda
npm install
npm run build
cd ..
```

### 3. Train and Package the Model

```bash
# Run the training script
./scripts/train-and-package-model.sh
```

This will:
- Activate the virtual environment
- Train the Linear Regression model on synthetic house data
- Package the model as `model/build/model.tar.gz`

Expected output:
```
Training complete!
Model Performance:
  Train R² Score: 0.99+
  Test R² Score: 0.99+
✓ Model packaged successfully: model/build/model.tar.gz
```

### 4. Bootstrap CDK (First Time Only)

```bash
# Bootstrap CDK for ap-northeast-1 region
cdk bootstrap aws://ACCOUNT-ID/ap-northeast-1
```

Replace `ACCOUNT-ID` with your AWS account ID.

### 5. Get Your AWS Account ID

```bash
aws sts get-caller-identity --query Account --output text
```

Note this account ID - you'll need it for the S3 bucket name.

### 6. Build TypeScript

```bash
npm run build
```

### 7. Upload Model to S3

After deploying the stack (step 8), you'll get a bucket name. Upload the model:

```bash
# The bucket name will be: sagemaker-house-price-model-{ACCOUNT_ID}
aws s3 cp model/build/model.tar.gz s3://sagemaker-house-price-model-YOUR_ACCOUNT_ID/model.tar.gz
```

**IMPORTANT**: You must upload the model BEFORE the SageMaker endpoint fully initializes, or upload it first if you synthesize the stack first.

### 8. Deploy CDK Stack

```bash
# Review changes
cdk diff

# Deploy
cdk deploy
```

**Deployment time**: 5-10 minutes (SageMaker endpoint takes longest)

### 9. Get API Endpoint

After deployment completes, you'll see outputs:

```
Outputs:
SagemakerStack1Stack.ApiUrl = https://xxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/
SagemakerStack1Stack.PredictEndpoint = https://xxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/predict
SagemakerStack1Stack.ModelBucketName = sagemaker-house-price-model-123456789012
SagemakerStack1Stack.SageMakerEndpointName = house-price-predictor
```

Save the `PredictEndpoint` URL.

## Testing the API

### Option 1: Use the Test Script

```bash
./scripts/test-api.sh "https://YOUR-API-URL/prod/predict"
```

### Option 2: Manual curl

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

Expected response:
```json
{
  "predicted_price": 385000,
  "model_version": "v1",
  "input": {
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2000,
    "year_built": 2015
  },
  "timestamp": "2025-11-29T18:00:00.000Z"
}
```

## Monitoring

### Check SageMaker Endpoint Status

```bash
aws sagemaker describe-endpoint --endpoint-name house-price-predictor --region ap-northeast-1
```

Status should be: `InService`

### View Lambda Logs

```bash
aws logs tail /aws/lambda/SagemakerStack1Stack-PredictHandler --follow --region ap-northeast-1
```

### View API Gateway Logs

Check in AWS Console:
- API Gateway → APIs → House Price Prediction API → Stages → prod → Logs

## Troubleshooting

### Issue: SageMaker endpoint fails to deploy

**Solution**: Check CloudWatch logs for the endpoint:
```bash
aws logs tail /aws/sagemaker/Endpoints/house-price-predictor --follow --region ap-northeast-1
```

Common causes:
- Model.tar.gz not uploaded to S3
- Incorrect model package structure
- Missing inference.py in the package

### Issue: Lambda timeout

**Solution**:
- Check if SageMaker endpoint is `InService`
- Increase Lambda timeout in stack (currently 30s)
- Check Lambda CloudWatch logs for errors

### Issue: "Model file not found" error

**Solution**: Verify model.tar.gz structure:
```bash
tar -tzf model/build/model.tar.gz
```

Should contain:
```
model.joblib
code/inference.py
code/requirements.txt
```

### Issue: API returns 500 error

**Solution**: Check Lambda logs:
```bash
aws logs tail /aws/lambda/SagemakerStack1Stack-PredictHandler --region ap-northeast-1
```

## Cost Estimation

**Development/Testing** (per month):

| Service | Usage | Cost |
|---------|-------|------|
| SageMaker Endpoint (ml.t2.medium) | 730 hours | ~$50-60 |
| Lambda | 1000 invocations | ~$0.20 |
| API Gateway | 1000 requests | ~$0.01 |
| S3 | 1 GB storage | ~$0.02 |
| **Total** | | **~$50-60/month** |

**Cost-saving tip**: Destroy the stack when not in use:
```bash
cdk destroy
```

## Clean Up

To avoid ongoing charges:

```bash
# Destroy all resources
cdk destroy

# Verify deletion
aws sagemaker list-endpoints --region ap-northeast-1
aws s3 ls | grep sagemaker-house-price-model
```

## Project Structure

```
sagemaker-stack-1/
├── bin/
│   └── sagemaker-stack-1.ts       # CDK app entry
├── lib/
│   └── sagemaker-stack-1-stack.ts # Main infrastructure
├── lambda/
│   ├── predict-handler.ts         # API request handler
│   ├── package.json
│   └── tsconfig.json
├── model/
│   ├── data/
│   │   └── house_data.csv        # Training data (200 samples)
│   ├── train.py                  # Model training script
│   ├── inference.py              # SageMaker inference handler
│   ├── requirements.txt          # Python dependencies
│   └── build/
│       └── model.tar.gz         # Packaged model (generated)
├── scripts/
│   ├── train-and-package-model.sh # Train and package
│   └── test-api.sh               # API testing
└── docs/
    └── ml-api-implementation-plan.md
```

## Next Steps

1. **Improve the model**:
   - Add more features (location, garage, etc.)
   - Try different algorithms (Random Forest, XGBoost)
   - Use real estate data instead of synthetic

2. **Add monitoring**:
   - CloudWatch dashboards
   - Model drift detection
   - Performance metrics

3. **Security**:
   - Add API Gateway authentication (API keys, Cognito)
   - Implement rate limiting
   - Add input validation/sanitization

4. **Production readiness**:
   - Add auto-scaling to SageMaker endpoint
   - Implement CI/CD pipeline
   - Add model versioning
   - Blue-green deployments

## Support

For issues or questions:
- Check CloudWatch logs first
- Review the implementation plan: `docs/ml-api-implementation-plan.md`
- Verify AWS service limits for your account
