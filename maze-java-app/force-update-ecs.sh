#!/bin/bash
set -e

# This script forces ECS to pull the latest image and redeploy
# You need to have AWS CLI configured with proper permissions

# Replace these with your actual values
CLUSTER_NAME="YOUR_CLUSTER_NAME"  # e.g., MazeEcsCluster-xxxxxx
SERVICE_NAME="YOUR_SERVICE_NAME"   # e.g., MazeService-xxxxxx

# Allow override from command line
if [ "$1" != "" ]; then
  CLUSTER_NAME="$1"
fi

if [ "$2" != "" ]; then
  SERVICE_NAME="$2"
fi

echo "Forcing update of service: $SERVICE_NAME in cluster: $CLUSTER_NAME"
aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment

echo "Update initiated. Check your ECS console for deployment status."
echo "Your service should pull the latest image and update within a few minutes." 