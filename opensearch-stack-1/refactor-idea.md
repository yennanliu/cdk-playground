  1. Naming Inconsistencies

  - Mixed naming patterns: opensearch-service-domain-cdk-stack.ts vs kinesis-firehose-stack.ts
  - Interface names: opensearchServiceDomainCdkProps vs KinesisFirehoseStackProps
  - Class names: OpensearchServiceDomainCdkStack (inconsistent capitalization)

  2. Major Code Duplication

  - Two OpenSearch stacks: opensearch-service-domain-cdk-stack.ts AND opensearch-stack-1-stack.ts (nearly identical!)
  - Lambda processors: EKS and Pod processors share 80% of decompression/transformation logic
  - IAM policies: Firehose role permissions repeated across stacks

  3. Poor Separation of Concerns

  - stack-composer.ts does too much (config parsing + orchestration + validation)
  - OpenSearch stack creates Firehose roles (should be in Firehose stack)
  - Hardcoded passwords in multiple places: 'Admin@OpenSearch123!'

  🎯 Refactoring Plan

  Phase 1: Structure & Naming

  lib/
  ├── constructs/           # Reusable components
  │   ├── opensearch-domain.ts
  │   ├── log-processor.ts
  │   └── iam-roles.ts
  ├── stacks/              # Clean stack separation
  │   ├── opensearch-stack.ts
  │   ├── firehose-stack.ts
  │   └── network-stack.ts
  ├── config/              # Centralized configuration
  │   ├── types.ts         # TypeScript interfaces
  │   └── validator.ts     # Input validation
  └── app.ts               # Main orchestrator

  Phase 2: Eliminate Duplication

  - Remove legacy stack: Delete opensearch-stack-1-stack.ts
  - Unified Lambda processor: Single configurable processor for EKS/Pod logs
  - Shared IAM module: Centralized role definitions
  - Extract secrets: Use AWS Secrets Manager instead of hardcoded passwords

  Phase 3: Better Configuration

  - Typed config interfaces: Replace loose JSON with TypeScript types
  - Environment-specific configs: config/dev.json, config/prod.json
  - Validation layer: Proper error messages instead of generic throws

  Phase 4: Clean Architecture

  Core Infrastructure → OpenSearch Domain → Data Pipeline Stacks
                                          ↘ Lambda Stack ↙

  🏗️ Specific Improvements

  Naming Fixes

  - OpensearchServiceDomainCdkStack → OpenSearchDomainStack
  - opensearch-service-domain-cdk-stack.ts → opensearch-domain-stack.ts
  - bin/opensearch-stack-1.ts → bin/app.ts

  Code Consolidation

  - Lambda processors: Merge EKS/Pod processors with strategy pattern
  - IAM roles: Extract to shared constructs/iam-roles.ts
  - Configuration: Create typed interfaces replacing default-values.json

  Security

  - Remove all hardcoded 'Admin@OpenSearch123!' passwords
  - Use AWS Secrets Manager for credentials
  - Replace wildcard IAM permissions with least-privilege policies


