#!/bin/bash

set -e  # Exit on any error

echo "=== GitLab AWS Deployment Script ==="
echo

echo "Step 1: Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo

echo "Step 2: Building TypeScript code..."
npm run build
echo "✅ Build completed"
echo

echo "Step 3: Synthesizing CloudFormation template..."
npx cdk synth
echo "✅ CloudFormation template synthesized"
echo

echo "Step 4: Deploying stack to AWS..."
npx cdk deploy --require-approval never
echo "✅ Deployment complete"
echo

echo "You can now access GitLab using the URL shown in the outputs above."
echo "Note: GitLab may take a few minutes to fully initialize on first startup."
echo "The GitLab container logs can be viewed in the CloudWatch console." 