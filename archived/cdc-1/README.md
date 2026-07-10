# CDC System - Change Data Capture

A simple AWS-based Change Data Capture system using CDK TypeScript that automatically synchronizes data between two MySQL databases.

## Architecture Overview

This system captures changes from a source MySQL database (DB1) and automatically replicates them to a target MySQL database (DB2) in real-time using AWS DMS.

### Architecture Diagram

```
┌─────────────┐    ┌─────────────────┐    ┌─────────────┐
│             │    │                 │    │             │
│    DB1      │    │   AWS DMS       │    │    DB2      │
│  (Source)   │───▶│ Replication     │───▶│  (Target)   │
│   MySQL     │    │   Instance      │    │   MySQL     │
│             │    │                 │    │             │
└─────────────┘    └─────────────────┘    └─────────────┘
       │                     │                     │
       │                     │                     │
   ┌───▼───┐            ┌────▼────┐           ┌────▼────┐
   │Binlog │            │CloudWatch│          │ Synced  │
   │Enabled│            │Monitoring│          │  Data   │
   └───────┘            └─────────┘          └─────────┘
```

## System Components

### Core Components
1. **Source Database (DB1)** - RDS MySQL with binary logging enabled
2. **Target Database (DB2)** - RDS MySQL (destination)
3. **AWS DMS** - Database Migration Service for CDC
4. **CloudWatch** - Monitoring and alerts

### Data Flow
1. Applications write to DB1 (source MySQL)
2. MySQL binary log captures all data changes
3. DMS reads binlog continuously for CDC
4. DMS applies changes to DB2 in real-time
5. DB2 maintains synchronized state with DB1

## Key Features
- **Real-time Synchronization** - Near real-time data replication
- **Minimal Components** - Simple 3-component architecture
- **Managed Service** - AWS DMS handles CDC complexity
- **Built-in Reliability** - Automatic retry and error handling
- **Monitoring** - CloudWatch integration for observability

## CDK Implementation

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
