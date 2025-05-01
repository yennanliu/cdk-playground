# GitLab Deployment on AWS using CDK

This is a project for deploying GitLab on AWS using AWS CDK with TypeScript.

## Architecture

The infrastructure includes:

* VPC with public and private subnets across 2 availability zones
* ECS Fargate Cluster for containerized GitLab deployment
* EFS for persistent storage of GitLab data
* Application Load Balancer for public access
* Security Groups to control network access

## Prerequisites

* AWS CLI configured with appropriate credentials
* Node.js 14.x or later
* AWS CDK installed (`npm install -g aws-cdk`)

## Deployment

1. Install dependencies:
```
npm install
```

2. Synthesize CloudFormation template:
```
npx cdk synth
```

3. Deploy the stack:
```
npx cdk deploy
```

After deployment, the GitLab URL will be displayed in the outputs section.

## Cleanup

To destroy the resources:
```
npx cdk destroy
```

## Configuration

If you need to customize the GitLab deployment, edit the stack in `lib/gitlab-deployment-v2-stack.ts`.
