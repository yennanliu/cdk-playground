#!/bin/bash

# Cleanup script for subscription filters
set -e

LOG_GROUPS=(
    "/aws/eks/EksCluster3394B24C-ec2cbedced464f24bf3f9d1c4b112048/cluster"
    "/aws/eks/EksCluster3394B24C-ec2cbedced464f24bf3f9d1c4b112048/application"
)

echo "Checking and cleaning up subscription filters..."

for LOG_GROUP in "${LOG_GROUPS[@]}"; do
    echo "Checking log group: $LOG_GROUP"
    
    # Check if log group exists
    if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$LOG_GROUP"; then
        echo "  Log group exists"
        
        # Get existing subscription filters
        FILTERS=$(aws logs describe-subscription-filters --log-group-name "$LOG_GROUP" --query 'subscriptionFilters[].filterName' --output text 2>/dev/null || echo "")
        
        if [ ! -z "$FILTERS" ]; then
            echo "  Found subscription filters: $FILTERS"
            for FILTER in $FILTERS; do
                echo "  Deleting filter: $FILTER"
                aws logs delete-subscription-filter --log-group-name "$LOG_GROUP" --filter-name "$FILTER" || echo "  Failed to delete filter: $FILTER"
            done
        else
            echo "  No subscription filters found"
        fi
    else
        echo "  Log group does not exist"
    fi
    echo ""
done

echo "Cleanup completed!"