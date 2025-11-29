#!/bin/bash
set -e

echo "=================================="
echo "Train and Package ML Model"
echo "=================================="

# Navigate to model directory
cd "$(dirname "$0")/../model"

echo ""
echo "Step 1: Installing Python dependencies..."
pip install -r requirements.txt

echo ""
echo "Step 2: Training model..."
python train.py

echo ""
echo "Step 3: Packaging model..."
cd build

# Create code directory with inference script
mkdir -p code
cp ../inference.py code/
cp ../requirements.txt code/

# Create model.tar.gz with proper structure
# SageMaker expects: model.tar.gz containing model.joblib and code/inference.py
echo "Creating model.tar.gz..."
tar -czf model.tar.gz model.joblib code/

# Cleanup
rm -rf code

echo ""
echo "✓ Model packaged successfully: model/build/model.tar.gz"
echo ""
echo "Next steps:"
echo "1. Upload model.tar.gz to S3:"
echo "   aws s3 cp model.tar.gz s3://YOUR-BUCKET-NAME/model.tar.gz"
echo ""
echo "2. Deploy CDK stack:"
echo "   cdk deploy"
