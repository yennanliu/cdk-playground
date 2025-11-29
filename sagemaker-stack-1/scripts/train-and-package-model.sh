#!/bin/bash
set -e

echo "=================================="
echo "Train and Package ML Model"
echo "=================================="

# Navigate to project root
PROJECT_ROOT="$(dirname "$0")/.."
cd "$PROJECT_ROOT"

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed!"
    echo ""
    echo "Please install uv first:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo ""
    echo "Or on macOS:"
    echo "  brew install uv"
    echo ""
    echo "Documentation: https://docs.astral.sh/uv/guides/install-python/"
    exit 1
fi

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo ""
    echo "Virtual environment not found!"
    echo "Please run setup first:"
    echo "  ./scripts/setup-python-env.sh"
    exit 1
fi

# Activate virtual environment
echo ""
echo "Activating virtual environment..."
source .venv/bin/activate

# Navigate to model directory
cd model

echo ""
echo "Step 1: Verifying Python dependencies..."
python --version
echo "Using Python from: $(which python)"

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
