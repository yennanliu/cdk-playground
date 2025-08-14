# CDK Stack Refactor: Group CloudWatch → Lambda → OpenSearch by Application Type

## Current Structure Analysis

- Currently creates separate Lambda functions per log type (firehose-processor for EKS logs, pod-logs-processor for pod logs)
- Each Lambda processes one specific log type with hardcoded logic
- Subscription filters are created per log group in kinesis-firehose-stack.ts
- Configuration is simple: just eksControlPlaneGroup and podLogGroupName

## Refactoring Plan

### 1. Configuration Changes

- Add AppTypeConfig interface to define application types with their associated log groups
- Add mapping structure like:
```typescript
appTypeConfigs: [
  {
    appType: "rails_app",
    logGroups: ["/aws/eks/rails-cluster/application", "/aws/containerinsights/rails/application"],
    transformationModule: "rails-processor"
  },
  {
    appType: "node_service", 
    logGroups: ["/aws/eks/node-cluster/application"],
    transformationModule: "node-processor"
  }
]
```

### 2. Lambda Structure Refactoring

Create new Lambda directory structure:
```
lambda/
  app-processors/
    rails-processor/
      index.js
    node-processor/
      index.js
    batch-processor/
      index.js
  shared/
    log-processing.js (common utilities)
```

- Each app-type Lambda will contain transformation logic specific to that application type
- Use environment variables to identify which app type the Lambda processes

### 3. CDK Stack Changes

- Modify KinesisFirehoseStack to create one Lambda per app type instead of per log group
- Create multiple subscription filters per Lambda (one for each log group in the app type)
- Update the stack composer to iterate over appTypeConfigs instead of individual log group names

### 4. Architecture Changes

**Proposed Architecture (1 Lambda per app type, multiple log groups):**

```
Log Group A (rails) ──┐
                      ├→ Subscription Filters → Firehose → Rails Lambda → OpenSearch
Log Group B (rails) ──┘

Log Group C (node) ───┐
                      ├→ Subscription Filters → Firehose → Node Lambda → OpenSearch  
Log Group D (node) ───┘

Log Group E (batch) ──→ Subscription Filter → Firehose → Batch Lambda → OpenSearch
```

**Key Changes:**
- One Lambda per application type (not per log group)
- One Firehose per application type (not per log group)  
- Multiple subscription filters per Lambda - each log group in an app type gets its own subscription filter, but they all feed the same Firehose/Lambda combination
- App-type-specific transformation logic - each Lambda contains logic tailored to that application type

### 5. Backward Compatibility

- Keep existing eksControlPlaneGroup/podLogGroupName config working alongside new system
- Provide migration path for existing configurations

This approach will eliminate code duplication, make it easier to add new application types, and group related log processing logic together.