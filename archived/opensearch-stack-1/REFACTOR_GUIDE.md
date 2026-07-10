# CloudWatch → Lambda → OpenSearch Refactor Guide

## Overview

The CDK stack has been refactored to group CloudWatch → Lambda → OpenSearch ingestion by application type instead of creating separate Lambdas per log group. This reduces code duplication and makes it easier to manage logs from similar applications.

## Architecture

**New Architecture (1 Lambda per app type, multiple log groups):**

```
Log Group A (rails) ──┐
                      ├→ Subscription Filters → Firehose → Rails Lambda → OpenSearch
Log Group B (rails) ──┘

Log Group C (node) ───┐
                      ├→ Subscription Filters → Firehose → Node Lambda → OpenSearch  
Log Group D (node) ───┘

Log Group E (batch) ──→ Subscription Filter → Firehose → Batch Lambda → OpenSearch
```

## Key Changes

- **One Lambda per application type** (not per log group)
- **One Firehose per application type** (not per log group)  
- **Multiple subscription filters per Lambda** - each log group in an app type gets its own subscription filter, but they all feed the same Firehose/Lambda combination
- **App-type-specific transformation logic** - each Lambda contains logic tailored to that application type

## Configuration Structure

### Dev Configuration Example (`lib/config/dev.json`)

```json
// exp 1
{
  "domainName": "opensearch-dev-domain",
  "appTypeConfigs": [
    {
      "appType": "eks-control-plane",
      "logGroups": ["/aws/eks/dev-cluster/application"],
      "transformationModule": "eks-processor"
    },
    {
      "appType": "eks-pod", 
      "logGroups": ["/aws/containerinsights/dev-cluster/application"],
      "transformationModule": "pod-processor"
    }
  ]
}

// exp 2
 {
    "domainName": "opensearch-dev-domain",
    "engineVersion": "OS_2.5",
    "dataNodeType": "t3.small.search",
    "dataNodeCount": 1,
    "ebsEnabled": true,
    "ebsVolumeSize": 10,
    "ebsVolumeType": "GP3",
    "vpcEnabled": false,
    "availabilityZoneCount": 1,
    "appTypeConfigs": [
      {
        "appType": "eks_cluster",
        "logGroups": [
          "/aws/eks/EksCluster3394B24C-4a7f56e614724b4998b51ae4d3eaa46c/cluster",
          "/aws/eks/EksCluster3394B24C-5a669018a0d64b3fab014289364f5236/cluster"
        ],
        "transformationModule": "eks-processor"
      }
    ]
  }
```

### Lambda Directory Structure

```
lambda/
  app-processors/
    eks-processor/
      index.js
    pod-processor/
      index.js
    batch-processor/        # Example new processor
      index.js
  shared/
    log-processing.js       # Common utilities
```

## Adding a New App Type

To add a new application type (e.g., "batch-processor" for batch job logs):

### 1. Create Lambda Processor

Create a new directory and processor: `lambda/app-processors/batch-processor/index.js`

```javascript
const { LogProcessor } = require('../../shared/log-processing');

const processor = new LogProcessor();

function processBatchLogEvent(logData, logEvent, processorInstance) {
    const messageJson = processorInstance.tryParseJSON(logEvent.message);
    
    if (messageJson && messageJson.batchJobId) {
        // Batch job specific processing
        const uniqueId = processorInstance.generateUniqueId(logData, logEvent, messageJson.batchJobId);
        
        return {
            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
            ...processorInstance.createBaseLogEvent(logData, logEvent, 'batch-job'),
            job_id: messageJson.batchJobId,
            job_name: messageJson.jobName,
            status: messageJson.status,
            message: messageJson.message,
            log_type: 'batch-job'
        };
    }
    
    // Fallback to generic processing
    const uniqueId = processorInstance.generateUniqueId(logData, logEvent, logEvent.message);
    return {
        id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
        ...processorInstance.createBaseLogEvent(logData, logEvent, 'batch-raw'),
        message: logEvent.message
    };
}

exports.handler = async (event) => {
    const output = [];
    
    for (const record of event.records) {
        const outputRecord = processor.processRecord(record, processBatchLogEvent);
        output.push(outputRecord);
    }
    
    return { records: output };
};
```

### 2. Update Configuration

Add the new app type to your configuration file:

```json
// dev.json
{
  "appTypeConfigs": [
    {
      "appType": "eks-control-plane",
      "logGroups": ["/aws/eks/dev-cluster/application"],
      "transformationModule": "eks-processor"
    },
    {
      "appType": "eks-pod",
      "logGroups": ["/aws/containerinsights/dev-cluster/application"], 
      "transformationModule": "pod-processor"
    },
    {
      "appType": "batch_app",
      "logGroups": ["/aws/batch/job-logs", "/aws/batch/system-logs"],
      "transformationModule": "batch-processor"
    }
  ]
}
```

### 3. Deploy

```bash
npm run build
cdk synth
cdk deploy
```

This will automatically:
- Create a new Lambda function for batch processing
- Create a new Firehose delivery stream for batch logs  
- Create subscription filters for all log groups in the batch_app configuration
- Create a new OpenSearch index called `batch_app-logs`

## Benefits

1. **Reduced Lambda Functions**: Instead of N Lambdas for N log groups, you have M Lambdas for M application types
2. **Code Reuse**: Similar log processing logic is consolidated into app-type specific handlers
3. **Easy Scaling**: Adding new log groups to existing app types requires only configuration changes
4. **Clear Organization**: Logs are grouped by their application semantics rather than their source location

## Migration from Old System

The old individual log group approach has been completely replaced. If you had:
- `kinesisFirehoseEksStack` → Now `kinesisFirehoseEksAppStack`  
- `kinesisFirehosePodStack` → Now `kinesisFirehosePodAppStack`

The functionality is preserved but now uses the new app-type based architecture.