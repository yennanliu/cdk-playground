#!/bin/bash

# MySQL Binlog to OpenSearch CDK Deployment Script

set -e

echo "🚀 Starting deployment of MySQL Binlog to OpenSearch infrastructure..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo "❌ AWS CDK is not installed. Please install it first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building the project..."
npm run build

# Bootstrap CDK (only needed once per account/region)
echo "🔧 Bootstrapping CDK..."
cdk bootstrap

# Deploy the stack
echo "🚀 Deploying the stack..."
cdk deploy --require-approval never

echo "✅ Deployment completed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Check the output values for important endpoints and ARNs"
echo "2. Connect to your MySQL database and create some test tables"
echo "3. Insert/update/delete data to see binlog events flowing to OpenSearch"
echo "4. Access OpenSearch via the provided endpoint to query your data"
echo ""
echo "🔍 To view the stack resources:"
echo "cdk list"
echo ""
echo "🗑️  To destroy the stack:"
echo "cdk destroy" 