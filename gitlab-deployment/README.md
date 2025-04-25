# GitLab Deployment on AWS using CDK

This project deploys a simple GitLab instance on AWS using EC2 for the application and RDS for the database.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js and npm installed
- AWS CDK installed
- An EC2 key pair named `gitlab-key` created in your AWS account (for SSH access)

## Deployment Instructions

1. Install dependencies:
   ```
   npm install
   ```

2. Create the EC2 key pair (if not already created):
   ```
   ./scripts/create-key-pair.sh
   ```
   This script will create a key pair named `gitlab-key` and save the private key to `gitlab-key.pem`.

3. Bootstrap the AWS CDK (if not already done):
   ```
   npx cdk bootstrap
   ```

4. Deploy the stack:
   ```
   npx cdk deploy
   ```

5. After deployment, the CDK will output:
   - GitLab URL: The URL to access your GitLab instance
   - SSH Command: Command to SSH into the instance
   - GitLab DB Secret Name: The name of the secret in AWS Secrets Manager that contains the database credentials

## Important Notes

- This is a simple deployment without considerations for scalability or high security.
- The EC2 instance is a t3.xlarge which should be sufficient for a small GitLab deployment.
- The RDS instance is a t3.micro PostgreSQL database.
- The initial setup might take a few minutes to complete after deployment.
- You will need to wait approximately 5-10 minutes after deployment for GitLab to fully initialize.
- The first time you access GitLab, you'll need to set up the admin password.

## Cleanup

To remove all resources:
```
npx cdk destroy
```
