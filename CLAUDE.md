# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is an AWS CDK playground repository containing multiple independent Infrastructure as Code (IaC) projects. Each subdirectory represents a separate CDK stack implementing different AWS infrastructure patterns.

## Repository Structure

- **Monorepo of CDK Projects**: Each top-level directory (e.g., `eks-stack-2/`, `ecs-wordpress-2/`, `urlShortener-app/`) is an independent CDK project
- **Standard CDK Layout**: Each project follows the standard CDK structure:
  - `bin/` - CDK app entry point
  - `lib/` - Stack definitions (TypeScript)
  - `test/` - Jest tests
  - `package.json` - Dependencies and scripts
  - `cdk.json` - CDK configuration
  - `tsconfig.json` - TypeScript configuration

## Common Commands

### Initial Setup
```bash
# Install CDK CLI globally (if not already installed)
npm install -g aws-cdk

# Install dependencies for a specific project
cd <project-directory>
npm install

# First-time setup: Bootstrap CDK (run once per AWS account/region)
cdk bootstrap
```

### Development Workflow
```bash
# Compile TypeScript to JavaScript
npm run build

# Watch mode for development
npm run watch

# List all stacks in the CDK app
cdk list

# Synthesize CloudFormation template
cdk synth

# Show differences between deployed stack and current code
cdk diff

# Deploy stack
cdk deploy

# Deploy with hotswap (faster, for development)
cdk deploy --hotswap

# Force deploy (skip UPDATE_ROLLBACK_COMPLETE wait)
cdk deploy --force

# Deploy all stacks
cdk deploy --all

# Destroy stack
cdk destroy <StackName>
```

### Testing
```bash
# Run all tests
npm test

# Run unit tests only (example from html-nginx)
npm run test:unit

# Run snapshot tests
npm run test:snapshot

# Update snapshot tests
npm run test:snapshot:update

# Run integration tests
npm run test:integration

# Run tests with coverage
npm run test:coverage
```

### Lambda Projects
For projects with Lambda functions (e.g., `urlShortener-app/`, `lambda-crudl/`):
```bash
# Compile TypeScript Lambda code to JavaScript
npx tsc -p tsconfig.lambda.json

# The compiled output goes to dist/lambda/
# CDK references the compiled JS files, not the TS source
```

## Architecture Patterns

### ECS-based Applications
Projects like `ecs-wordpress-2`, `ecs-test-1`, `ecs-kafka-ui` follow this pattern:
- VPC with public/private subnets
- ECS Cluster with Fargate tasks
- Application Load Balancer (ALB) for ingress
- RDS/EFS for persistent storage
- Auto-scaling based on CPU/memory
- CloudWatch logging

### EKS-based Applications
Projects like `eks-stack-2` implement:
- EKS cluster with managed node groups
- AWS Load Balancer Controller
- Cluster autoscaler
- Container Insights for monitoring
- VPC with flow logs
- IAM roles for service accounts (IRSA)

### Serverless Applications
Projects like `urlShortener-app`, `lambda-crudl` use:
- Lambda functions for compute
- API Gateway for HTTP endpoints
- DynamoDB for data storage
- S3 for static hosting

### Database Patterns
- **Read/Write Separation**: `app-read-write-postgre-stack-1` uses Aurora with separate writer/reader endpoints
- **Read Replicas**: `mysql-read-write-replica` demonstrates MySQL read replica setup
- **Database Migration**: `dms-s3-stack-1` shows DMS (Database Migration Service) patterns

## Key Conventions

### Stack Naming
- Stack names typically match the directory name
- Example: `eks-stack-2/` defines `EksStack2Stack`

### Resource Removal
- Most stacks use `RemovalPolicy.DESTROY` for development
- Production stacks should use `RemovalPolicy.RETAIN` or `RemovalPolicy.SNAPSHOT` for databases

### Security Groups
- Least-privilege approach: specific ingress rules, restricted egress where appropriate
- ECS tasks run in private subnets with NAT Gateway for outbound access

### Secrets Management
- Database credentials stored in AWS Secrets Manager
- Secrets injected as environment variables or ECS secrets

### TypeScript Lambda Functions
- Lambda source code is in TypeScript but must be compiled to JavaScript
- Use `tsconfig.lambda.json` for Lambda compilation
- CDK references `dist/lambda/` directory, not source `lambda/` directory

## Working with Multiple Stacks

When deploying a new stack while another is being destroyed:
```bash
cdk deploy --output cdk.out2.deploy
```

## AWS Configuration

Ensure AWS CLI is configured:
```bash
aws configure
```

## Testing Philosophy

- **Unit tests**: Test individual construct logic
- **Snapshot tests**: Capture CloudFormation template structure
- **Integration tests**: Test actual deployed resources (use sparingly due to cost)

## Common Issues

### Lambda Deployment
If Lambda deployment fails, ensure TypeScript is compiled:
```bash
npx tsc -p tsconfig.lambda.json
```

### CDK Version Compatibility
Projects use various CDK versions. Check `package.json` for the specific version in use. Most projects use `aws-cdk-lib` v2.x.

### MySQL Version
Recent fixes address MySQL version compatibility (see commit `a357380`).

### Development Guide

- ALWAYS fix TS code format, and remove the compiled JS code (`*.js`, `*.d.ts`) when edit, build CDK code, or consider using below package.json setting:

```json
"scripts": {
  "build": "tsc",
  "watch": "tsc -w",
  "test": "jest",
  "cdk": "cdk",
  "clean": "find lib -name '*.js' -delete && find lib -name '*.d.ts' -delete && find lib -name '*.js.map' -delete && find bin -name '*.js' -delete && find bin -name '*.d.ts' -delete && find bin -name '*.js.map' -delete",
  "clean:all": "npm run clean && rm -rf node_modules cdk.out"
},
```