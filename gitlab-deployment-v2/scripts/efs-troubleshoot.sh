#!/bin/bash

# Script to diagnose and potentially fix EFS mounting issues in the GitLab deployment

set -e

# Get the stack name
STACK_NAME="GitlabDeploymentV2Stack"

echo "=== EFS Troubleshooting Script ==="
echo

# Get EFS File System ID
echo "Retrieving EFS File System ID..."
EFS_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='EfsFileSystemId'].OutputValue" --output text)

if [ -z "$EFS_ID" ]; then
    echo "❌ Could not retrieve EFS File System ID. Make sure the stack is deployed."
    exit 1
fi

echo "Found EFS File System ID: $EFS_ID"

# Get EFS Security Group
echo "Retrieving security groups..."
EFS_SG=$(aws efs describe-mount-target-security-groups --file-system-id $EFS_ID --mount-target-id $(aws efs describe-mount-targets --file-system-id $EFS_ID --query "MountTargets[0].MountTargetId" --output text) --query "SecurityGroups[0]" --output text)

echo "EFS Security Group: $EFS_SG"

# Get ECS Service Security Group
CLUSTER_NAME=$(aws cloudformation describe-stack-resources --stack-name $STACK_NAME --logical-resource-id GitLabCluster --query "StackResources[0].PhysicalResourceId" --output text)
SERVICE_NAME=$(aws cloudformation describe-stack-resources --stack-name $STACK_NAME --logical-resource-id GitLabService --query "StackResources[0].PhysicalResourceId" --output text)

TASK_ARN=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --query "taskArns[0]" --output text)

if [ "$TASK_ARN" == "None" ]; then
    echo "❌ No running tasks found. The service might be failing to start tasks."
else
    TASK_DETAILS=$(aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks $TASK_ARN)
    ENI_ID=$(echo $TASK_DETAILS | jq -r '.tasks[0].attachments[0].details[] | select(.name=="networkInterfaceId") | .value')
    
    if [ -z "$ENI_ID" ] || [ "$ENI_ID" == "null" ]; then
        echo "❌ Could not retrieve network interface details from the task."
    else
        ECS_SG=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI_ID --query "NetworkInterfaces[0].Groups[0].GroupId" --output text)
        echo "ECS Service Security Group: $ECS_SG"
        
        # Check security group rules
        echo "Checking security group rules..."
        INBOUND_RULE=$(aws ec2 describe-security-group-rules --filter Name=group-id,Values=$EFS_SG --query "SecurityGroupRules[?IpProtocol=='tcp' && FromPort==2049 && ToPort==2049].GroupId" --output text)
        
        if [ -z "$INBOUND_RULE" ]; then
            echo "❌ EFS security group does not allow inbound traffic on port 2049."
            echo "Would you like to add this rule? (y/n)"
            read -r response
            if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
                echo "Adding inbound rule to EFS security group..."
                aws ec2 authorize-security-group-ingress --group-id $EFS_SG --protocol tcp --port 2049 --source-group $ECS_SG
                echo "✅ Security group rule added."
            fi
        else
            echo "✅ EFS security group allows inbound traffic on port 2049."
        fi
    fi
fi

# Check EFS mount targets
echo "Checking EFS mount targets..."
MOUNT_TARGETS=$(aws efs describe-mount-targets --file-system-id $EFS_ID)
MOUNT_TARGET_COUNT=$(echo $MOUNT_TARGETS | jq '.MountTargets | length')

echo "Found $MOUNT_TARGET_COUNT mount targets."

for (( i=0; i<$MOUNT_TARGET_COUNT; i++ ))
do
    MT_ID=$(echo $MOUNT_TARGETS | jq -r ".MountTargets[$i].MountTargetId")
    MT_STATE=$(echo $MOUNT_TARGETS | jq -r ".MountTargets[$i].LifeCycleState")
    MT_SUBNET=$(echo $MOUNT_TARGETS | jq -r ".MountTargets[$i].SubnetId")
    
    echo "Mount Target $MT_ID in subnet $MT_SUBNET is in state: $MT_STATE"
    
    if [ "$MT_STATE" != "available" ]; then
        echo "⚠️  Mount target is not in 'available' state. This could cause mounting issues."
    fi
done

# Check IAM permissions
echo "Checking IAM permissions..."
TASK_DEF=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --query "services[0].taskDefinition" --output text)
EXECUTION_ROLE=$(aws ecs describe-task-definition --task-definition $TASK_DEF --query "taskDefinition.executionRoleArn" --output text)
TASK_ROLE=$(aws ecs describe-task-definition --task-definition $TASK_DEF --query "taskDefinition.taskRoleArn" --output text)

echo "Task Execution Role: $EXECUTION_ROLE"
echo "Task Role: $TASK_ROLE"

# Extract role name from ARN
EXECUTION_ROLE_NAME=$(echo $EXECUTION_ROLE | cut -d'/' -f2)
TASK_ROLE_NAME=$(echo $TASK_ROLE | cut -d'/' -f2)

# Check for EFS permissions in the policies
EXECUTION_POLICIES=$(aws iam list-attached-role-policies --role-name $EXECUTION_ROLE_NAME --query "AttachedPolicies[].PolicyArn" --output text)
TASK_POLICIES=$(aws iam list-attached-role-policies --role-name $TASK_ROLE_NAME --query "AttachedPolicies[].PolicyArn" --output text)

echo "Checking for EFS permissions..."
for POLICY_ARN in $EXECUTION_POLICIES $TASK_POLICIES
do
    POLICY_NAME=$(echo $POLICY_ARN | cut -d'/' -f2)
    POLICY_VERSION=$(aws iam get-policy --policy-arn $POLICY_ARN --query "Policy.DefaultVersionId" --output text)
    POLICY_DOC=$(aws iam get-policy-version --policy-arn $POLICY_ARN --version-id $POLICY_VERSION)
    
    if echo $POLICY_DOC | grep -q "elasticfilesystem:Client"; then
        echo "✅ Found EFS permissions in policy $POLICY_NAME"
    fi
done

# Check if the ECS task has proper access to EFS
echo "Checking EFS access points..."
ACCESS_POINTS=$(aws efs describe-access-points --file-system-id $EFS_ID)
AP_COUNT=$(echo $ACCESS_POINTS | jq '.AccessPoints | length')

if [ "$AP_COUNT" -eq 0 ]; then
    echo "⚠️  No access points found for this EFS file system."
    echo "Consider creating an access point for better management of EFS access."
else
    echo "Found $AP_COUNT access points."
    for (( i=0; i<$AP_COUNT; i++ ))
    do
        AP_ID=$(echo $ACCESS_POINTS | jq -r ".AccessPoints[$i].AccessPointId")
        AP_PATH=$(echo $ACCESS_POINTS | jq -r ".AccessPoints[$i].RootDirectory.Path")
        
        echo "Access Point $AP_ID with path $AP_PATH"
    done
fi

echo
echo "=== Troubleshooting Summary ==="
echo
echo "If EFS mounting issues persist, try the following:"
echo
echo "1. Force a redeployment of the ECS service:"
echo "   aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment"
echo
echo "2. Check CloudWatch Logs for detailed error messages:"
echo "   aws logs get-log-events --log-group /ecs/gitlab --log-stream ecs/GitLabContainer/<task-id>"
echo
echo "3. Verify that the latest platform version is used for Fargate tasks:"
echo "   Make sure platformVersion is set to LATEST or VERSION1_4 in the CDK code"
echo
echo "4. Ensure the EFS file system and task are in the same VPC and compatible subnets"
echo
echo "For more details, see the docs/MONITORING.md file" 