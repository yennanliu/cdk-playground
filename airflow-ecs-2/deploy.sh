#!/bin/bash

# Airflow ECS CDK Deployment Script
# This script handles the complete deployment of Airflow on AWS ECS Fargate

set -e

echo "🚀 Starting Airflow ECS deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    print_error "AWS CLI is not configured or credentials are invalid"
    print_status "Please run 'aws configure' to set up your credentials"
    exit 1
fi

# Get current AWS account and region
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "us-east-1")

print_status "Deploying to Account: $ACCOUNT_ID, Region: $REGION"

# Install dependencies
print_status "Installing dependencies..."
npm install

# Check if CDK is bootstrapped
print_status "Checking CDK bootstrap status..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION > /dev/null 2>&1; then
    print_warning "CDK not bootstrapped in this region"
    print_status "Bootstrapping CDK..."
    npx cdk bootstrap
    print_success "CDK bootstrap completed"
else
    print_success "CDK already bootstrapped"
fi

# Build the project
print_status "Building TypeScript project..."
npm run build
print_success "Build completed"

# Synthesize CloudFormation template
print_status "Synthesizing CloudFormation template..."
npx cdk synth > /dev/null
print_success "Template synthesis completed"

# Deploy the stack
print_status "Deploying Airflow ECS stack..."
print_warning "This may take 10-15 minutes to complete..."

if npx cdk deploy --require-approval never; then
    print_success "Deployment completed successfully!"
    
    # Get the outputs
    echo ""
    print_status "Getting deployment outputs..."
    AIRFLOW_URL=$(aws cloudformation describe-stacks \
        --stack-name AirflowEcs2Stack \
        --query 'Stacks[0].Outputs[?OutputKey==`AirflowURL`].OutputValue' \
        --output text)
    
    DB_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name AirflowEcs2Stack \
        --query 'Stacks[0].Outputs[?OutputKey==`DatabaseEndpoint`].OutputValue' \
        --output text)
    
    echo ""
    echo "=============================================="
    print_success "🎉 Airflow deployment completed!"
    echo "=============================================="
    echo ""
    echo "📊 Airflow Web UI: $AIRFLOW_URL"
    echo "🔑 Username: admin"
    echo "🔑 Password: admin123"
    echo "🗄️  Database: $DB_ENDPOINT"
    echo ""
    print_warning "Note: It may take 5-10 minutes for the service to start"
    print_warning "Check ECS service status if the UI is not accessible"
    echo ""
    print_status "Useful commands:"
    echo "  • Check service status: aws ecs describe-services --cluster airflow-cluster --services AirflowService"
    echo "  • View logs: aws logs tail /ecs/airflow --follow"
    echo "  • Destroy stack: cdk destroy"
    echo ""
else
    print_error "Deployment failed!"
    exit 1
fi 