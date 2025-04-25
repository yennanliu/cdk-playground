#!/bin/bash

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq is not installed. Please install it first."
    exit 1
fi

# Set key pair name
KEY_NAME="gitlab-key"
KEY_FILE="${KEY_NAME}.pem"

# Check if the key pair already exists
if aws ec2 describe-key-pairs --key-names ${KEY_NAME} 2>&1 | grep -q "InvalidKeyPair.NotFound"; then
    echo "Creating new key pair: ${KEY_NAME}"
    
    # Create key pair and save to file
    aws ec2 create-key-pair --key-name ${KEY_NAME} --query 'KeyMaterial' --output text > ${KEY_FILE}
    
    # Set correct permissions
    chmod 400 ${KEY_FILE}
    
    echo "Key pair ${KEY_NAME} created and saved to ${KEY_FILE}"
    echo "The private key file has been saved with permissions set to 400 (read-only for owner)."
else
    echo "Key pair ${KEY_NAME} already exists."
    echo "If you don't have the private key file, delete the key pair and run this script again:"
    echo "aws ec2 delete-key-pair --key-name ${KEY_NAME}"
fi 