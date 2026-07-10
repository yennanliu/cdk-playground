# N8N on AWS ECS Fargate

This project deploys [n8n](https://n8n.io/) workflow automation platform on AWS using ECS Fargate. The infrastructure is defined using AWS CDK in TypeScript.

## Access

- account: admin
- pwd: admin

- email: test@google.com
- first name, last name: test
- pwd: Test_n8n_123

## Architecture

The stack creates the following AWS resources:
- VPC with 2 Availability Zones
- ECS Cluster
- Fargate Service with Application Load Balancer
- Auto Scaling configuration (min: 1, max: 2 tasks)

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js and npm installed
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Deployment

1. Install dependencies:
```bash
npm install
```

2. Build the TypeScript code:
```bash
npm run build
```

3. Deploy the stack:
```bash
cdk deploy
```

After deployment, the ALB DNS name will be displayed in the outputs.

## Configuration

The n8n instance is configured with:
- Basic authentication enabled
  - Username: admin
  - Password: admin
- HTTP protocol (not HTTPS)
- Container port: 5678
- Fargate configuration:
  - CPU: 512
  - Memory: 1024MB
  - Desired count: 1 task

## Security Considerations

For production deployments, consider:
- Using stronger authentication credentials
- Storing sensitive data in AWS Secrets Manager
- Enabling HTTPS/SSL
- Setting N8N_SECURE_COOKIE to "true" when using HTTPS
- Implementing more restrictive security groups
- Using private subnets with NAT gateway

## Useful Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

## Clean Up

To avoid incurring charges, destroy the stack when no longer needed:
```bash
cdk destroy
```
