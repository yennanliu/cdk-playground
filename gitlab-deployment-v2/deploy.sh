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

# Extract EFS File System ID from the outputs
echo "Step 5: Validating EFS configuration..."
EFS_ID=$(aws cloudformation describe-stacks --stack-name GitlabDeploymentV2Stack --query "Stacks[0].Outputs[?OutputKey=='EfsFileSystemId'].OutputValue" --output text)

if [ -z "$EFS_ID" ]; then
    echo "⚠️  Could not retrieve EFS File System ID. Skipping EFS validation."
else
    echo "Found EFS File System ID: $EFS_ID"
    
    # Check mount targets
    MOUNT_TARGETS=$(aws efs describe-mount-targets --file-system-id $EFS_ID --query "MountTargets[].LifeCycleState" --output text)
    
    if [[ "$MOUNT_TARGETS" == *"available"* ]]; then
        echo "✅ EFS mount targets are available"
    else
        echo "⚠️  EFS mount targets might not be fully available yet. This could cause mounting issues."
        echo "    Please check the EFS console to ensure mount targets are in 'available' state."
    fi
fi

echo
echo "You can now access GitLab using the URL shown in the outputs above."
echo "Note: GitLab may take a few minutes to fully initialize on first startup."
echo "The GitLab container logs can be viewed in the CloudWatch console."
echo
echo "If you encounter EFS mounting issues, check the following:"
echo "1. Security groups allow traffic on port 2049 between ECS tasks and EFS"
echo "2. EFS mount targets are available in all subnets where ECS tasks run"
echo "3. IAM permissions allow ECS tasks to access EFS"
echo
echo "For detailed troubleshooting steps, see docs/MONITORING.md" 