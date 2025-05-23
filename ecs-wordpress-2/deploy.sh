#!/bin/bash

# WordPress on ECS Deployment Script
set -e

echo "🚀 Starting WordPress on ECS deployment..."

# Build the project
echo "📦 Building TypeScript project..."
npm run build

# Check if CDK is bootstrapped
echo "🔧 Checking CDK bootstrap status..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS CLI not configured. Please run 'aws configure' first."
    exit 1
fi

# Deploy the stack
echo "🏗️  Deploying WordPress stack..."
echo "⏱️  This will take approximately 10-15 minutes..."
cdk deploy --require-approval never

echo "✅ Deployment completed!"
echo ""
echo "🎉 Your WordPress site is being set up!"
echo "📋 Important next steps:"
echo "   1. Wait 2-3 minutes for the ECS tasks to become healthy"
echo "   2. Navigate to the Load Balancer DNS URL shown in the outputs above"
echo "   3. Complete the WordPress installation wizard"
echo "   4. Create your admin account"
echo ""
echo "🔍 To monitor the deployment:"
echo "   - Check ECS Console: https://console.aws.amazon.com/ecs/"
echo "   - View logs: aws logs tail /ecs/wordpress --follow"
echo ""
echo "💰 Remember to run 'cdk destroy' when you're done to avoid charges!" 