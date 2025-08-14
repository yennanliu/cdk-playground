# Opensearch Stack 1

## Run

```bash

npm install

cdk bootstrap

# deploy

cdk deploy --all

# use default eks, pod cloudwatch log group
cdk deploy --all --stage dev

# send pods cloudwatch log to opensearch ONLY
cdk deploy --all --stage dev \
    -c eksPodGroup="/aws/eks/EksCluster3394B24C-ed22b92ec4764ec592ea533328f9e9da/application"


# send both eks, pods cloudwatch log to opensearch
  cdk deploy --all --force --stage dev \
      -c domainName="opensearch-domain-dev-12" \
      -c eksControlPlaneGroup="/aws/eks/EksCluster3394B24C-996e8229a5784d1c97f30f4c94106da3/cluster" \
      -c eksPodGroup="/aws/eks/EksCluster3394B24C-996e8229a5784d1c97f30f4c94106da3/application" \
      -c mazeLogGroupName="MazeCdkStack-4-MazeTaskDefMazeContainerLogGroup4C11E95F-DjUOHja9qNtz" \
      -c postgresLogGroupName="/aws/rds/instance/rubyappinfra1stack-3-cicd-databasepostgresinstance-tshvw8bdzwcd/postgresql"
```

## CDK Architecture

```mermaid
graph TB
    subgraph "CDK Application"
        App[bin/app.ts]
        App --> SC[StackComposer]
        SC --> Config[ConfigManager]
    end

    subgraph "Configuration Layer"
        Config --> Parser[ConfigParser]
        Config --> Validator[ConfigValidator]
        Parser --> DevConfig[config/dev.json]
        Parser --> ProdConfig[config/prod.json]
    end

    subgraph "Infrastructure Stacks"
        SC --> NS[NetworkStack]
        SC --> OS[OpenSearchDomainStack]
        SC --> EKSFirehose[KinesisFirehose EKS Stack]
        SC --> PodFirehose[KinesisFirehose Pod Stack]
    end

    subgraph "NetworkStack (Optional)"
        NS --> VPC[VPC]
        NS --> Subnets[Private Subnets]
        NS --> SG[Security Groups]
    end

    subgraph "OpenSearchDomainStack"
        OS --> Domain[OpenSearch Domain]
        OS --> FirehoseRole[Firehose IAM Role]
        OS --> CWRole[CloudWatch Logs Role]
        OS --> RoleMapper[Role Mapper Lambda]
        Domain --> RoleMapper
    end

    subgraph "KinesisFirehoseStack (EKS)"
        EKSFirehose --> EKSDeliveryStream[Firehose Delivery Stream]
        EKSFirehose --> EKSProcessor[Unified Log Processor Lambda]
        EKSFirehose --> EKSBucket[S3 Backup Bucket]
        EKSFirehose --> EKSSubscription[CloudWatch Logs Subscription Filter]
    end

    subgraph "KinesisFirehoseStack (Pod)"
        PodFirehose --> PodDeliveryStream[Firehose Delivery Stream]
        PodFirehose --> PodProcessor[Unified Log Processor Lambda]
        PodFirehose --> PodBucket[S3 Backup Bucket]
        PodFirehose --> PodSubscription[CloudWatch Logs Subscription Filter]
    end

    subgraph "Lambda Functions"
        RoleMapper --> RoleMapperPy[opensearch-role-mapper.py]
        IndexManager[opensearch-index-manager.py]
        EKSProcessor --> UnifiedProcessor[unified-processor/index.js]
        PodProcessor --> UnifiedProcessor
        UnifiedProcessor --> SharedUtils[shared/log-processing.js]
    end

    subgraph "Data Flow"
        CloudWatchLogs[CloudWatch Logs] --> EKSSubscription
        CloudWatchLogs --> PodSubscription
        EKSSubscription --> EKSDeliveryStream
        PodSubscription --> PodDeliveryStream
        EKSDeliveryStream --> EKSProcessor
        PodDeliveryStream --> PodProcessor
        EKSProcessor --> Domain
        PodProcessor --> Domain
        EKSDeliveryStream -.-> EKSBucket
        PodDeliveryStream -.-> PodBucket
    end

    subgraph "External Dependencies"
        VPC -.-> Domain
        Subnets -.-> Domain
        SG -.-> Domain
        FirehoseRole --> Domain
        CWRole --> EKSDeliveryStream
        CWRole --> PodDeliveryStream
    end

    classDef configClass fill:#e1f5fe
    classDef stackClass fill:#f3e5f5
    classDef lambdaClass fill:#fff3e0
    classDef dataClass fill:#e8f5e8
    
    class Config,Parser,Validator,DevConfig,ProdConfig configClass
    class NS,OS,EKSFirehose,PodFirehose stackClass
    class RoleMapperPy,IndexManager,UnifiedProcessor,SharedUtils lambdaClass
    class CloudWatchLogs,Domain,EKSDeliveryStream,PodDeliveryStream dataClass
```

### Architecture Overview

This CDK application implements a centralized logging solution that ingests CloudWatch logs from EKS clusters and Pod applications into OpenSearch for analysis and visualization.

#### Key Components:

**Configuration Layer:**
- Environment-specific configuration management (dev/prod)
- Type-safe configuration parsing and validation
- Centralized configuration in JSON files

**Infrastructure Stacks:**
- **NetworkStack**: Optional VPC, subnets, and security groups for OpenSearch domain
- **OpenSearchDomainStack**: OpenSearch domain with IAM roles and security configuration
- **KinesisFirehoseStack**: Data pipeline for log ingestion (separate stacks for EKS and Pod logs)

**Lambda Functions:**
- **Role Mapper**: Configures OpenSearch security roles for Firehose access
- **Index Manager**: Manages OpenSearch indices and templates
- **Unified Processor**: Processes and transforms CloudWatch logs for OpenSearch ingestion

**Data Pipeline:**
1. CloudWatch Logs → Subscription Filters
2. Subscription Filters → Kinesis Data Firehose
3. Firehose → Lambda Processor (log transformation)
4. Lambda Processor → OpenSearch Domain
5. Failed records → S3 Backup Buckets

#### Features:
- **Environment-aware**: Separate configurations for dev/prod environments
- **Flexible networking**: Optional VPC deployment for enhanced security
- **Unified processing**: Single Lambda processor handles both EKS and Pod logs
- **Error handling**: S3 backup for failed deliveries
- **Security**: IAM roles with least-privilege access
- **Monitoring**: CloudWatch Logs for Firehose operations

## Data Flow Chart

```mermaid
flowchart TD
    Start([CDK Deploy]) --> LoadConfig[Load Environment Config]
    LoadConfig --> ValidateConfig{Valid Config?}
    ValidateConfig -->|No| ConfigError[Configuration Error]
    ValidateConfig -->|Yes| CreateNetwork{VPC Enabled?}
    
    CreateNetwork -->|Yes| NetworkStack[Create Network Stack]
    CreateNetwork -->|No| OpenSearchStack[Create OpenSearch Stack]
    NetworkStack --> OpenSearchStack
    
    OpenSearchStack --> CreateDomain[Create OpenSearch Domain]
    CreateDomain --> CreateRoles[Create IAM Roles]
    CreateRoles --> RoleMapping[Configure Role Mapping]
    RoleMapping --> IndexTemplates[Create Index Templates]
    
    IndexTemplates --> CheckEKSLogs{EKS Logs Configured?}
    CheckEKSLogs -->|Yes| EKSFirehoseStack[Create EKS Firehose Stack]
    CheckEKSLogs -->|No| CheckPodLogs{Pod Logs Configured?}
    
    EKSFirehoseStack --> EKSResources[Create EKS Resources]
    EKSResources --> CheckPodLogs
    
    CheckPodLogs -->|Yes| PodFirehoseStack[Create Pod Firehose Stack]
    CheckPodLogs -->|No| DeployComplete[Deployment Complete]
    PodFirehoseStack --> PodResources[Create Pod Resources]
    PodResources --> DeployComplete
    
    subgraph "EKS Log Processing Flow"
        EKSLogs[EKS CloudWatch Logs] --> EKSFilter[Subscription Filter]
        EKSFilter --> EKSFirehose[Kinesis Data Firehose]
        EKSFirehose --> EKSLambda[Unified Processor Lambda]
        EKSLambda --> EKSTransform{Transform Success?}
        EKSTransform -->|Yes| OpenSearch[OpenSearch Domain]
        EKSTransform -->|No| EKSS3[S3 Backup Bucket]
        EKSFirehose -.->|Failed Records| EKSS3
    end
    
    subgraph "Pod Log Processing Flow"
        PodLogs[Pod CloudWatch Logs] --> PodFilter[Subscription Filter]
        PodFilter --> PodFirehose[Kinesis Data Firehose]
        PodFirehose --> PodLambda[Unified Processor Lambda]
        PodLambda --> PodTransform{Transform Success?}
        PodTransform -->|Yes| OpenSearch
        PodTransform -->|No| PodS3[S3 Backup Bucket]
        PodFirehose -.->|Failed Records| PodS3
    end
    
    subgraph "Lambda Processing Details"
        ProcessStart[Receive Firehose Records] --> Decompress[Decompress GZIP Data]
        Decompress --> ParseJSON[Parse CloudWatch Logs JSON]
        ParseJSON --> ProcessType{Processing Type?}
        ProcessType -->|EKS| EKSProcessor[Process EKS Log Events]
        ProcessType -->|Pod| PodProcessor[Process Pod Log Events]
        
        EKSProcessor --> EKSExtract[Extract Cluster Info]
        EKSExtract --> EKSStructure[Structure EKS Document]
        EKSStructure --> CombineEKS[Combine Events to NDJSON]
        
        PodProcessor --> PodExtract[Extract Kubernetes Metadata]
        PodExtract --> PodStructure[Structure Pod Document]
        PodStructure --> CombinePod[Combine Events to NDJSON]
        
        CombineEKS --> ReturnSuccess[Return Success Response]
        CombinePod --> ReturnSuccess
        ReturnSuccess --> ProcessEnd[End Processing]
    end
    
    subgraph "Error Handling"
        ProcessError[Processing Error] --> LogError[Log Error Details]
        LogError --> ReturnFailed[Return ProcessingFailed]
        ReturnFailed --> S3Backup[Record Sent to S3]
    end
    
    subgraph "OpenSearch Operations"
        OpenSearch --> IndexCheck{Index Exists?}
        IndexCheck -->|No| AutoCreate[Auto-create from Template]
        IndexCheck -->|Yes| StoreDocument[Store Document]
        AutoCreate --> StoreDocument
        StoreDocument --> IndexComplete[Indexing Complete]
    end
    
    classDef startEnd fill:#d4edda,stroke:#155724
    classDef process fill:#cce5ff,stroke:#004085
    classDef decision fill:#fff3cd,stroke:#856404
    classDef error fill:#f8d7da,stroke:#721c24
    classDef success fill:#d1ecf1,stroke:#0c5460
    
    class Start,DeployComplete,ProcessEnd,IndexComplete startEnd
    class LoadConfig,CreateDomain,CreateRoles,EKSResources,PodResources,ProcessStart,Decompress,ParseJSON process
    class ValidateConfig,CreateNetwork,CheckEKSLogs,CheckPodLogs,EKSTransform,PodTransform,ProcessType,IndexCheck decision
    class ConfigError,ProcessError,LogError error
    class OpenSearch,StoreDocument success
```

### Data Flow Overview

This flowchart illustrates the complete data processing pipeline from CDK deployment to log ingestion and OpenSearch indexing.

#### Deployment Phase:
1. **Configuration Loading**: Environment-specific configs (dev/prod) are loaded and validated
2. **Infrastructure Creation**: Network (optional) → OpenSearch Domain → Firehose Stacks
3. **Security Setup**: IAM roles, role mapping, and index templates are configured
4. **Pipeline Setup**: Subscription filters connect CloudWatch Logs to Firehose streams

#### Runtime Processing:
1. **Log Ingestion**: CloudWatch Logs → Subscription Filters → Kinesis Data Firehose
2. **Lambda Processing**: Unified processor transforms logs based on type (EKS/Pod)
3. **Data Transformation**: Decompression → JSON parsing → field extraction → document structuring
4. **OpenSearch Delivery**: Structured documents delivered to OpenSearch with auto-indexing
5. **Error Handling**: Failed records automatically backed up to S3

#### Key Processing Steps:
- **EKS Logs**: Extract cluster information, service names, log levels
- **Pod Logs**: Parse Kubernetes metadata, container information, application logs  
- **Document Structure**: Create OpenSearch-compatible documents with proper field mappings
- **Batch Processing**: Multiple log events combined into newline-delimited JSON
- **Fault Tolerance**: Processing failures trigger S3 backup with detailed error logging

