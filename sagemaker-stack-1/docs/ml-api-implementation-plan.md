# SageMaker ML API Implementation Plan

## Project Overview
Build a simple, production-ready ML API using AWS SageMaker for real-time inference. This implementation focuses on simplicity while maintaining best practices.

---

## Use Case: House Price Prediction

**Model**: Scikit-learn Linear Regression
**Input**: House features (bedrooms, bathrooms, square footage, year built)
**Output**: Predicted house price in USD

### Sample Request/Response
```json
// Request
POST /predict
{
  "bedrooms": 3,
  "bathrooms": 2,
  "sqft": 2000,
  "year_built": 2010
}

// Response
{
  "predicted_price": 425000,
  "model_version": "v1",
  "timestamp": "2025-11-29T17:50:00Z"
}
```

---

## Architecture Components

### 1. ML Model Package
**Location**: `model/`

**Files**:
- `train.py` - Script to train simple sklearn model
- `inference.py` - SageMaker inference handler
- `requirements.txt` - Python dependencies
- `model.joblib` - Trained model artifact (generated)

**Training Data**: Simple CSV with synthetic house data (100-200 records)

### 2. CDK Infrastructure Stack
**Location**: `lib/sagemaker-ml-api-stack.ts`

**Components**:
```typescript
- S3 Bucket (model artifacts)
- SageMaker Model
- SageMaker Endpoint Configuration (ml.t2.medium)
- SageMaker Endpoint
- Lambda Function (API handler)
- API Gateway REST API
- IAM Roles & Policies
- CloudWatch Log Groups
```

### 3. Lambda Function
**Location**: `lambda/predict-handler.ts`

**Responsibilities**:
- Input validation
- Invoke SageMaker endpoint
- Error handling
- Response formatting

### 4. API Gateway
- REST API with single route: `POST /predict`
- CORS enabled for web access
- Optional: API key for basic auth

---

## Implementation Steps

### Phase 1: Model Development
**Estimated effort**: 30 minutes

1. **Create model directory structure**:
   ```
   model/
   ├── train.py
   ├── inference.py
   ├── requirements.txt
   └── data/
       └── house_data.csv
   ```

2. **Generate synthetic training data**:
   - 200 samples with features: bedrooms, bathrooms, sqft, year_built
   - Target: price (with realistic correlation)

3. **Train simple model**:
   - Use scikit-learn LinearRegression
   - Train on synthetic data
   - Save as `model.joblib`
   - Validation R² score > 0.8

4. **Create inference handler**:
   - Implement SageMaker `model_fn()` - load model
   - Implement `input_fn()` - parse JSON input
   - Implement `predict_fn()` - run prediction
   - Implement `output_fn()` - format JSON response

5. **Package model**:
   - Create `model.tar.gz` with:
     - `model.joblib`
     - `inference.py`
     - `requirements.txt`
   - Ready for S3 upload

### Phase 2: Infrastructure Setup
**Estimated effort**: 1 hour

6. **Update CDK Stack** (`lib/sagemaker-ml-api-stack.ts`):

   **a. S3 Bucket**:
   ```typescript
   - Create bucket for model artifacts
   - Enable versioning
   - Set removal policy to DESTROY (dev environment)
   ```

   **b. SageMaker Model**:
   ```typescript
   - Use sklearn container image from AWS Deep Learning Containers
   - Image URI: sklearn inference container for region
   - Model data location: S3 URI
   - Execution role with S3 read access
   ```

   **c. Endpoint Configuration**:
   ```typescript
   - Instance type: ml.t2.medium (cheapest for dev)
   - Initial instance count: 1
   - No auto-scaling (keep simple)
   ```

   **d. SageMaker Endpoint**:
   ```typescript
   - Deploy endpoint with above config
   - Enable data capture (optional, for monitoring)
   ```

   **e. Lambda Function**:
   ```typescript
   - Runtime: Node.js 20.x
   - Handler: predict-handler.handler
   - Timeout: 30 seconds
   - Environment variables:
     - ENDPOINT_NAME: SageMaker endpoint name
   - IAM permissions: sagemaker:InvokeEndpoint
   ```

   **f. API Gateway**:
   ```typescript
   - REST API
   - POST /predict → Lambda integration
   - Enable CORS
   - Deploy to 'prod' stage
   ```

7. **Create Lambda Handler** (`lambda/predict-handler.ts`):
   ```typescript
   - Parse API Gateway event
   - Validate input schema
   - Call SageMaker endpoint via AWS SDK
   - Handle errors gracefully
   - Return formatted response
   ```

### Phase 3: Deployment
**Estimated effort**: 30 minutes

8. **Compile TypeScript**:
   ```bash
   npm run build
   ```

9. **Upload model to S3**:
   ```bash
   aws s3 cp model/model.tar.gz s3://<bucket>/models/house-price/model.tar.gz
   ```
   Or use CDK `BucketDeployment` construct

10. **Deploy CDK Stack**:
    ```bash
    cdk deploy
    ```
    - Wait 5-10 minutes for SageMaker endpoint deployment

11. **Test deployment**:
    ```bash
    curl -X POST <api-gateway-url>/predict \
      -H "Content-Type: application/json" \
      -d '{"bedrooms": 3, "bathrooms": 2, "sqft": 2000, "year_built": 2010}'
    ```

### Phase 4: Testing & Validation
**Estimated effort**: 30 minutes

12. **Unit tests**:
    - Test Lambda handler logic
    - Mock SageMaker client
    - Validate input/output schemas

13. **Integration tests**:
    - Test end-to-end API call
    - Verify SageMaker endpoint responds
    - Check error handling

14. **Load testing** (optional):
    - Simple load test with 10-50 concurrent requests
    - Verify latency < 1 second

---

## File Structure

```
sagemaker-stack-1/
├── bin/
│   └── sagemaker-stack-1.ts          # CDK app entry
├── lib/
│   └── sagemaker-ml-api-stack.ts     # Main stack definition
├── lambda/
│   ├── predict-handler.ts            # API handler
│   └── package.json                  # Lambda dependencies
├── model/
│   ├── train.py                      # Model training script
│   ├── inference.py                  # SageMaker inference handler
│   ├── requirements.txt              # Python dependencies
│   ├── data/
│   │   └── house_data.csv           # Training data
│   └── build/
│       └── model.tar.gz             # Packaged model
├── test/
│   ├── sagemaker-ml-api-stack.test.ts  # Stack tests
│   └── lambda/
│       └── predict-handler.test.ts   # Lambda tests
├── docs/
│   └── ml-api-implementation-plan.md # This document
└── scripts/
    ├── train-model.sh                # Train and package model
    └── test-api.sh                   # Test deployed API
```

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Infrastructure | AWS CDK | 2.x |
| Language (CDK) | TypeScript | 5.x |
| Language (Lambda) | TypeScript | 5.x |
| Language (Model) | Python | 3.10 |
| ML Framework | scikit-learn | 1.3.x |
| Container | AWS Deep Learning Containers | sklearn-inference |
| Compute | SageMaker ml.t2.medium | - |
| API | API Gateway REST API | v1 |

---

## Cost Estimation (Monthly, Development)

| Service | Usage | Estimated Cost |
|---------|-------|----------------|
| SageMaker Endpoint | ml.t2.medium (730 hrs) | ~$50-60/month |
| Lambda | 10K invocations, 512MB | ~$0.20/month |
| API Gateway | 10K requests | ~$0.04/month |
| S3 | 1 GB storage + requests | ~$0.05/month |
| **Total** | | **~$50-60/month** |

**Note**: SageMaker endpoint is always running. Consider serverless inference for lower costs in dev.

---

## Key Design Decisions

### 1. Why sklearn LinearRegression?
- Simple, interpretable model
- Fast training (<1 second)
- No GPU required
- Easy to debug
- Perfect for learning/demo purposes

### 2. Why ml.t2.medium?
- Cheapest CPU instance (~$0.065/hour)
- Sufficient for simple sklearn models
- No GPU needed for inference
- Good for dev/test environments

### 3. Why REST API (not Serverless Inference)?
- Consistent low latency (<100ms)
- Simpler cold start management
- Better for learning SageMaker fundamentals
- Can switch to serverless later if needed

### 4. Why Lambda + API Gateway?
- Serverless request handling
- Auto-scaling
- Pay per request
- Simple integration with API Gateway
- Easy to add auth, rate limiting later

---

## Success Criteria

- [ ] Model trains successfully with R² > 0.8
- [ ] SageMaker endpoint deploys without errors
- [ ] API responds to valid requests with predictions
- [ ] Response latency < 1 second (p95)
- [ ] Proper error handling for invalid inputs
- [ ] CloudWatch logs capture all requests
- [ ] CDK stack can be destroyed cleanly
- [ ] Total implementation cost < $0.50 for testing

---

## Future Enhancements (Out of Scope)

1. **Model Improvements**:
   - Use more complex model (Random Forest, XGBoost)
   - Add feature engineering
   - Implement cross-validation
   - Track model metrics in MLflow/SageMaker Experiments

2. **Infrastructure**:
   - Auto-scaling based on traffic
   - Multi-model endpoint
   - A/B testing with endpoint variants
   - VPC deployment for security

3. **Monitoring**:
   - Model drift detection
   - Data quality checks
   - Custom CloudWatch metrics
   - Alerting on errors/latency

4. **Authentication**:
   - Cognito user pools
   - API keys with usage plans
   - IAM authorization

5. **CI/CD**:
   - Automated model training pipeline
   - Model registry integration
   - Blue-green deployments
   - Automated testing

---

## Troubleshooting Guide

### Common Issues

**1. SageMaker Endpoint Deployment Fails**
- Check model.tar.gz structure (inference.py at root)
- Verify S3 permissions for SageMaker role
- Check CloudWatch logs for container errors

**2. Lambda Timeout**
- Increase timeout to 30s
- Check endpoint is InService status
- Verify Lambda has VPC access if endpoint in VPC

**3. Invalid Predictions**
- Validate input features match training data format
- Check feature scaling/preprocessing
- Review inference.py input_fn() implementation

**4. High Latency**
- Check SageMaker instance type
- Consider adding endpoint caching
- Review Lambda cold start times

---

## References

- [AWS SageMaker Documentation](https://docs.aws.amazon.com/sagemaker/)
- [SageMaker Python SDK](https://sagemaker.readthedocs.io/)
- [CDK SageMaker Constructs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sagemaker-readme.html)
- [AWS Deep Learning Containers](https://github.com/aws/deep-learning-containers)
- [Scikit-learn Inference](https://docs.aws.amazon.com/sagemaker/latest/dg/sklearn.html)

---

## Document Metadata

- **Created**: 2025-11-29
- **Project**: sagemaker-stack-1
- **Status**: Implementation Plan
- **Complexity**: Beginner-Friendly
- **Timeline**: 2-3 hours total implementation
