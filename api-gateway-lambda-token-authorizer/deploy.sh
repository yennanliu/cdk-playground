#!/bin/bash

echo "🚀 Deploying API Gateway Lambda Token Authorizer Stack..."

# Build the project
echo "📦 Building TypeScript..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please fix compilation errors."
    exit 1
fi

# Deploy the stack
echo "🏗️  Deploying CDK stack..."
npx cdk deploy --require-approval never

if [ $? -eq 0 ]; then
    echo "✅ Deployment completed successfully!"
    echo ""
    echo "🔗 Your API endpoints:"
    echo "   - Health endpoint: Check the outputs above for the health endpoint URL"
    echo "   - Protected endpoint: Check the outputs above for the protected endpoint URL"
    echo ""
    echo "🔐 Test with these tokens:"
    echo "   - Valid: 'allow' or 'valid-token-123'"
    echo "   - Invalid: 'deny' or 'invalid-token'"
    echo "   - Unauthorized: 'unauthorized'"
    echo ""
    echo "📝 Example usage:"
    echo "   curl -H \"Authorization: Bearer allow\" <health-endpoint-url>"
    echo "   curl -H \"Authorization: Bearer deny\" <protected-endpoint-url>"
else
    echo "❌ Deployment failed!"
    exit 1
fi 