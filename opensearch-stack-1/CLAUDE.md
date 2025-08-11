# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for file changes and auto-compile
- `npm test` - Run Jest tests
- `cdk synth` - Synthesize CloudFormation templates
- `cdk diff` - Compare deployed stack with current state
- `cdk deploy --all` - Deploy all stacks
- `cdk destroy --all` - Destroy all stacks

### CDK Deployment Commands
- `cdk bootstrap` - Bootstrap CDK environment (one-time setup)
- `cdk deploy --all --stage dev` - Deploy with dev environment configuration
- `cdk deploy --all --stage prod` - Deploy with prod environment configuration

### Context Parameters for Deployment
- `-c domainName="custom-domain-name"` - Override OpenSearch domain name
- `-c eksLogGroupName="/aws/eks/cluster-name/cluster"` - Specify EKS log group
- `-c podLogGroupName="/aws/eks/cluster-name/application"` - Specify Pod log group

## Architecture Overview

This is an AWS CDK application that implements a centralized logging solution for EKS clusters using OpenSearch. The system ingests CloudWatch logs through Kinesis Data Firehose and processes them with Lambda functions before storing in OpenSearch.

### Core Components

**StackComposer** (`lib/stack-composer.ts`): Main orchestrator that creates and manages all infrastructure stacks based on configuration.

**Configuration System** (`lib/config/`):
- Environment-specific configurations (dev/prod stages)
- Type-safe configuration parsing and validation
- Support for context parameters and runtime overrides

**Infrastructure Stacks**:
- **NetworkStack**: Optional VPC, subnets, and security groups for OpenSearch
- **OpenSearchDomainStack**: OpenSearch domain with IAM roles and security configuration
- **KinesisFirehoseStack**: Data pipeline for log ingestion (separate instances for EKS and Pod logs)

### Key Files

- `bin/app.ts` - CDK application entry point
- `lib/stack-composer.ts` - Main stack orchestration logic
- `lib/config/types.ts` - TypeScript interfaces for configuration
- `lib/config/parser.ts` - Configuration parsing logic
- `lib/config/validator.ts` - Configuration validation and transformation
- `lib/opensearch-domain-stack.ts` - OpenSearch domain infrastructure
- `lib/kinesis-firehose-stack.ts` - Firehose delivery streams and Lambda processors
- `lib/network-stack.ts` - VPC and networking resources

### Configuration Structure

The application uses a stage-based configuration system:
- **stage**: Environment identifier (dev/prod)
- **openSearch**: Domain configuration (instance types, node counts, EBS settings)
- **network**: VPC settings (optional, can reuse existing or create new)
- **logs**: CloudWatch log group configurations for EKS and Pod logs

### Data Flow

1. CloudWatch Logs → Subscription Filters → Kinesis Data Firehose
2. Firehose → Lambda Processor (log transformation) → OpenSearch Domain
3. Failed records → S3 backup buckets for retry/analysis

### Lambda Functions

The system includes Lambda functions for:
- **Unified Processor**: Transforms CloudWatch logs for OpenSearch ingestion
- **Role Mapper**: Configures OpenSearch security roles
- **Index Manager**: Manages OpenSearch indices and templates

## Important Notes

- DON'T save compiled .js or .d.ts files in lib/ - CDK handles compilation during deployment
- The application supports both single log group and multiple log group configurations
- Network stack is optional - OpenSearch can deploy in default VPC or custom VPC
- Each Firehose stack creates separate S3 buckets for backup storage
- Configuration validation ensures type safety and proper AWS resource parameters