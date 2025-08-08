# OpenSearch Logging Infrastructure Deployment Guide

## Overview
This guide explains how to deploy and verify the OpenSearch logging infrastructure with automatic index creation for EKS and Pod logs.

## Deployment Command
```bash
cdk deploy --all --stage dev \
    -c domainName="opensearch-domain-dev-5" \
    -c eksLogGroupName="/aws/eks/EksCluster3394B24C-ed22b92ec4764ec592ea533328f9e9da/cluster" \
    -c podLogGroupName="/aws/eks/EksCluster3394B24C-ed22b92ec4764ec592ea533328f9e9da/application"
```

## What Gets Deployed

### 1. OpenSearch Domain Stack
- OpenSearch domain with security enabled
- Master user: `admin` / Password: `Admin@OpenSearch123!`
- IAM roles for Firehose and CloudWatch Logs access
- Role mapping Lambda that configures:
  - Firehose role permissions
  - Index templates for auto-creation

### 2. Kinesis Firehose Stacks
- **EKS Stack**: Processes EKS cluster logs → `eks-logs` index
- **Pod Stack**: Processes Pod application logs → `pod-logs` index
- Each includes:
  - Unified Lambda processor
  - S3 backup bucket
  - CloudWatch Logs subscription filters

## Verification Steps

### 1. Check Deployment Status
```bash
# Check stack status
aws cloudformation describe-stacks --stack-name "OSServiceDomainCDKStack-opensearch-domain-dev-5"

# Get OpenSearch endpoint
aws cloudformation describe-stacks \
  --stack-name "OSServiceDomainCDKStack-opensearch-domain-dev-5" \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenSearchDomainEndpoint`].OutputValue' \
  --output text
```

### 2. Test Index Auto-Creation
```bash
# Run the provided test script
./scripts/test-index-creation.sh
```

### 3. Manual Verification
1. **Access OpenSearch Dashboards**:
   - URL: `https://{your-opensearch-endpoint}/_dashboards/`
   - Username: `admin`
   - Password: `Admin@OpenSearch123!`

2. **Check for indices**:
   ```bash
   curl -u admin:Admin@OpenSearch123! \
     "https://{your-endpoint}/_cat/indices?v"
   ```

3. **Check index templates**:
   ```bash
   curl -u admin:Admin@OpenSearch123! \
     "https://{your-endpoint}/_index_template" | jq .
   ```

## How Index Auto-Creation Works

1. **Index Templates**: Lambda creates templates for `eks-logs*` and `pod-logs*` patterns
2. **First Document**: When Firehose delivers first document matching pattern, OpenSearch creates index
3. **Structure**: Templates ensure consistent field mappings and settings

## Expected Indices

- **`eks-logs`**: EKS cluster logs with fields:
  - `@timestamp`, `log_level`, `message`
  - `eks.cluster_name`, `eks.service_name`
  - `aws.region`, `source`

- **`pod-logs`**: Pod application logs with fields:
  - `@timestamp`, `pod_name`, `namespace`
  - `container_name`, `cluster`, `log_type`
  - `message`, `log_group`, `log_stream`

## Troubleshooting

### Indices Not Created
1. **Check Firehose delivery**: Look at CloudWatch logs for delivery streams
2. **Verify log flow**: Ensure CloudWatch Logs are being sent to subscription filters
3. **Manual creation**: Use the index-creator Lambda if needed
4. **Template verification**: Check if templates were created successfully

### Access Issues
1. **Role mapping**: Verify Firehose role is mapped to `all_access`
2. **IAM permissions**: Ensure roles have correct OpenSearch permissions
3. **Network access**: Verify VPC/security group settings if applicable

### Log Processing Issues
1. **Lambda logs**: Check unified processor Lambda logs in CloudWatch
2. **Format validation**: Verify JSON format of processed logs
3. **Buffer settings**: Adjust Firehose buffering if needed

## Key Features

✅ **Auto-index creation** via templates
✅ **Unified Lambda processor** for EKS and Pod logs  
✅ **Consolidated IAM roles** for security
✅ **Proper error handling** and logging
✅ **Testing utilities** for verification
✅ **Optimized buffering** for faster delivery

## Security Notes

⚠️ **Production Considerations**:
- Change default admin password
- Use AWS Secrets Manager for credentials
- Restrict access policies as needed
- Enable VPC access if required
- Review IAM role permissions

## Support Files

- `scripts/test-index-creation.sh` - Test index creation
- `lambda/index-creator.py` - Manual index creation helper
- `lambda/opensearch-role-mapper.py` - Role mapping and template setup
- `lambda/unified-processor/` - Log processing logic