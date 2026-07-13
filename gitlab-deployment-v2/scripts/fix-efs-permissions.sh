#!/bin/bash

# Script to fix EFS permissions for GitLab using a temporary EC2 instance
# This should be run if GitLab has permission issues with the EFS volume

set -e

# Configuration variables
STACK_NAME="GitlabDeploymentV2Stack"
EC2_INSTANCE_TYPE="t3.micro"
EC2_KEY_NAME="" # Add your EC2 key pair name here if needed, or leave empty
EC2_INSTANCE_NAME="GitLab-EFS-Fix-Temp"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== GitLab EFS Permissions Fix Script ==="
echo

# Get EFS File System ID
echo "Retrieving EFS File System ID..."
EFS_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='EfsFileSystemId'].OutputValue" --output text)

if [ -z "$EFS_ID" ]; then
    echo "❌ Could not retrieve EFS File System ID. Make sure the stack is deployed."
    exit 1
fi

echo "Found EFS File System ID: $EFS_ID"

# Get VPC and subnet information
echo "Retrieving VPC and subnet information..."
VPC_ID=$(aws cloudformation describe-stack-resources --stack-name $STACK_NAME --logical-resource-id GitLabVpc --query "StackResources[0].PhysicalResourceId" --output text)
SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:aws-cdk:subnet-type,Values=Public" --query "Subnets[0].SubnetId" --output text)

echo "VPC ID: $VPC_ID"
echo "Subnet ID: $SUBNET_ID"

# Create temporary security group
echo "Creating temporary security group..."
SG_ID=$(aws ec2 create-security-group --group-name GitLab-EFS-Fix-SG --description "Temporary SG for EFS permissions fix" --vpc-id $VPC_ID --query "GroupId" --output text)

echo "Created security group: $SG_ID"

# Allow SSH access if key pair is provided
if [ ! -z "$EC2_KEY_NAME" ]; then
    echo "Adding SSH ingress rule..."
    aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0
    SSH_OPTION="--key-name $EC2_KEY_NAME"
else
    SSH_OPTION=""
fi

# Get EFS security group
EFS_SG=$(aws efs describe-mount-target-security-groups --file-system-id $EFS_ID --mount-target-id $(aws efs describe-mount-targets --file-system-id $EFS_ID --query "MountTargets[0].MountTargetId" --output text) --query "SecurityGroups[0]" --output text)

# Allow EFS access from the temporary security group
echo "Adding EFS ingress rule..."
aws ec2 authorize-security-group-ingress --group-id $EFS_SG --protocol tcp --port 2049 --source-group $SG_ID

# Create user data script
echo "Creating user data script..."
cat > ${SCRIPT_DIR}/user-data.sh << 'EOF'
#!/bin/bash

# Install necessary packages
yum update -y
yum install -y amazon-efs-utils nfs-utils

# Create mount directory
mkdir -p /mnt/efs

# Get the EFS ID from instance tags
EFS_ID=$(curl -s http://169.254.169.254/latest/meta-data/tags/instance/EfsId)

# Mount the EFS file system
echo "Mounting EFS file system $EFS_ID..."
mount -t efs $EFS_ID:/ /mnt/efs

# Check if mount was successful
if [ $? -ne 0 ]; then
    echo "Failed to mount EFS file system"
    exit 1
fi

# Fix permissions for GitLab
echo "Fixing GitLab directory permissions..."
mkdir -p /mnt/efs/git-data
mkdir -p /mnt/efs/.ssh
mkdir -p /mnt/efs/gitlab-rails
mkdir -p /mnt/efs/gitlab-ci
mkdir -p /mnt/efs/postgresql
mkdir -p /mnt/efs/redis
mkdir -p /mnt/efs/nginx
mkdir -p /mnt/efs/prometheus

# Set proper ownership for GitLab (UID/GID 998)
chown -R 998:998 /mnt/efs
chmod -R 775 /mnt/efs

# Create a marker file to indicate completion
touch /tmp/efs-fix-complete

# Shutdown when done
shutdown -h now
EOF

# Create instance
echo "Launching temporary EC2 instance..."
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id $(aws ssm get-parameters --names /aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2 --query "Parameters[0].Value" --output text) \
    --instance-type $EC2_INSTANCE_TYPE \
    --subnet-id $SUBNET_ID \
    --security-group-ids $SG_ID \
    $SSH_OPTION \
    --user-data file://${SCRIPT_DIR}/user-data.sh \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$EC2_INSTANCE_NAME},{Key=EfsId,Value=$EFS_ID}]" \
    --query "Instances[0].InstanceId" \
    --output text)

echo "Launched instance $INSTANCE_ID"
echo "Waiting for instance to initialize..."

# Wait for instance to be running
aws ec2 wait instance-running --instance-ids $INSTANCE_ID

echo "Instance is running. It will automatically fix EFS permissions and terminate."
echo "This process may take a few minutes."

# Wait for instance to terminate (after fixing permissions)
echo "Waiting for fix to complete and instance to terminate..."
aws ec2 wait instance-terminated --instance-ids $INSTANCE_ID

echo "✅ Instance terminated. Permissions should be fixed."

# Clean up security group
echo "Cleaning up temporary security group..."
aws ec2 delete-security-group --group-id $SG_ID

echo 
echo "EFS permissions have been fixed. Try redeploying the GitLab container now:"
echo "aws ecs update-service --cluster GitLabCluster --service GitLabService --force-new-deployment"
echo

# Remove temporary user data file
rm -f ${SCRIPT_DIR}/user-data.sh 