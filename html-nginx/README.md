# HTML Website with Nginx - CDK Project

This AWS CDK project creates a simple HTML website served by Nginx on an auto-scaling group of EC2 instances behind an Application Load Balancer.

## Architecture

The stack creates:
- A VPC with public subnets
- An Auto Scaling Group of EC2 instances running Nginx
- An Application Load Balancer
- Security Groups for web traffic
- IAM roles for EC2 instances
- S3 assets for the website content and Nginx configuration

## Prerequisites

- AWS CLI installed and configured
- Node.js and npm installed
- AWS CDK installed (`npm install -g aws-cdk`)

## Deployment Instructions

1. Install dependencies
   ```
   npm install
   ```

2. Bootstrap your AWS environment (if you haven't already)
   ```
   cdk bootstrap
   ```

3. Deploy the stack
   ```
   cdk deploy
   ```

4. After deployment, the CloudFormation stack outputs the URL of the load balancer. Use this URL to access your website.

## Customization

- **Website Content**: Modify the files in the `website` directory
- **Nginx Configuration**: Update the `website/nginx.conf` file
- **Instance Type**: Change the EC2 instance type in the stack if needed
- **Auto Scaling**: Adjust min/max capacity based on your needs

## Cleanup

To avoid incurring charges, delete the stack when no longer needed:
```
cdk destroy
```
