# OpenSearch Firehose Integration Debug Guide

## Problem
Firehose was receiving records but failing to write to OpenSearch with error:
```
{"errorCode":"OS.BulkWritePermissionDenied","errorMessage":"The Firehose role does not have permission to perform bulk writes on the OpenSearch cluster. Make sure your OpenSearch security policy grants necessary permissions to the Firehose role."}
```

## Debug Steps

### Step 1: Send Test Record to Firehose
```bash
aws firehose put-record \
  --delivery-stream-name Firehose-os-service-domain-41-cloudwatch-logs-stream \
  --record '{"Data": "'$(echo '{"timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'", "message": "Test log entry for debugging", "level": "INFO", "service": "debug-test", "user_id": "test123"}' | base64)'"}'
```
**Result**: ✅ Record accepted (RecordId returned)

### Step 2: Check if Data Reached OpenSearch
```bash
DOMAIN_ENDPOINT=$(aws opensearch describe-domain --domain-name os-service-domain-41 --query 'DomainStatus.Endpoint' --output text)
curl -X GET "https://$DOMAIN_ENDPOINT/cloudwatch-logs/_search?pretty" -u admin:Admin@OpenSearch123!
```
**Result**: ❌ `index_not_found_exception` - No data in OpenSearch

### Step 3: Check Available Indices
```bash
curl -X GET "https://$DOMAIN_ENDPOINT/_cat/indices?v" -u admin:Admin@OpenSearch123!
```
**Result**: Only system indices present (`.kibana_1`, `.opendistro_security`, etc.)

### Step 4: Check Firehose Error Logs
```bash
# Find Firehose log groups
aws logs describe-log-groups --query 'logGroups[?contains(logGroupName, `firehose`)].logGroupName' --output table

# Check for log streams
aws logs describe-log-streams --log-group-name "/aws/firehose/Firehose-os-service-domain-41-cloudwatch-logs"
```
**Result**: Log group exists but no streams yet (errors may take time to appear)

## Root Cause Analysis
**Issue**: OpenSearch Fine-Grained Access Control (FGAC) has two security layers:
1. **AWS IAM Level**: ✅ Working (Firehose role has `es:*` permissions)
2. **OpenSearch Internal Level**: ❌ Failing (Firehose role not mapped to OpenSearch roles)

## Solution Applied

### Step 5: Check Current Role Mapping
```bash
curl -X GET "https://$DOMAIN_ENDPOINT/_plugins/_security/api/rolesmapping/all_access" \
  -u admin:Admin@OpenSearch123! \
  -H "Content-Type: application/json"
```
**Result**: `{"all_access":{"hosts":[],"users":["admin"],"backend_roles":[],...}}`

### Step 6: Apply Role Mapping Fix
```bash
curl -X PUT "https://$DOMAIN_ENDPOINT/_plugins/_security/api/rolesmapping/all_access" \
  -u admin:Admin@OpenSearch123! \
  -H "Content-Type: application/json" \
  -d '{
    "backend_roles": [
      "arn:aws:iam::187326049035:role/Opensearch-os-service-domain-41-FirehoseRole"
    ],
    "hosts": [],
    "users": ["admin"]
  }'
```
**Result**: ✅ `{"status":"OK","message":"'all_access' updated."}`

### Step 7: Verify Role Mapping
```bash
curl -X GET "https://$DOMAIN_ENDPOINT/_plugins/_security/api/rolesmapping/all_access" \
  -u admin:Admin@OpenSearch123! \
  -H "Content-Type: application/json"
```
**Result**: ✅ Firehose role now in `backend_roles` array

## Verification Tests

### Test 1: Send New Record After Fix
```bash
aws firehose put-record \
  --delivery-stream-name Firehose-os-service-domain-41-cloudwatch-logs-stream \
  --record '{"Data": "'$(echo '{"timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'", "message": "Test after role mapping fix", "level": "INFO", "service": "firehose-test", "user_id": "test456"}' | base64)'"}'
```

### Test 2: Check Document Count Before/After
```bash
# Before
CURRENT_COUNT=$(curl -s -X GET "https://$DOMAIN_ENDPOINT/cloudwatch-logs/_count" -u admin:Admin@OpenSearch123! | jq -r '.count')
echo "Current count: $CURRENT_COUNT"

# Wait 90 seconds for processing
sleep 90

# After  
NEW_COUNT=$(curl -s -X GET "https://$DOMAIN_ENDPOINT/cloudwatch-logs/_count" -u admin:Admin@OpenSearch123! | jq -r '.count')
echo "New count: $NEW_COUNT"
```
**Result**: ✅ Count increased from 98 → 123 documents

### Test 3: Search for Specific Test Record
```bash
curl -X GET "https://$DOMAIN_ENDPOINT/cloudwatch-logs/_search?q=test_id:final-verification&pretty" \
  -u admin:Admin@OpenSearch123!
```
**Result**: ✅ Test record found with correct structure and timestamp

### Test 4: Verify Latest Records
```bash
curl -X GET "https://$DOMAIN_ENDPOINT/cloudwatch-logs/_search?sort=timestamp:desc&size=3&pretty" \
  -u admin:Admin@OpenSearch123!
```
**Result**: ✅ Our test records appear as most recent entries

## Final Status
- ✅ **Firehose accepting records**: RecordId returned successfully
- ✅ **OpenSearch receiving data**: Document count increasing  
- ✅ **Bulk writes working**: No more permission errors
- ✅ **Data integrity**: JSON structure and timestamps preserved
- ✅ **Real-time ingestion**: Records appear within ~60-90 seconds

## Key Learnings
1. **Two-layer security**: AWS IAM permissions ≠ OpenSearch FGAC permissions
2. **Role mapping required**: Backend roles must be explicitly mapped in OpenSearch
3. **Time delay**: Allow 60-90 seconds for Firehose processing
4. **Verification method**: Use document count + specific searches to confirm data flow

## Commands for Future Debugging
```bash
# Quick health check
curl -X GET "https://$DOMAIN_ENDPOINT/_cluster/health" -u admin:Admin@OpenSearch123!

# Check role mappings
curl -X GET "https://$DOMAIN_ENDPOINT/_plugins/_security/api/rolesmapping" -u admin:Admin@OpenSearch123!

# Monitor document count
curl -X GET "https://$DOMAIN_ENDPOINT/cloudwatch-logs/_count" -u admin:Admin@OpenSearch123!

# View recent records
curl -X GET "https://$DOMAIN_ENDPOINT/cloudwatch-logs/_search?sort=timestamp:desc&size=5" -u admin:Admin@OpenSearch123!
```