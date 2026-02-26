# Multi-User Claude Code Deployment Guide

## Overview

This guide covers deploying the multi-user version of Claude Code infrastructure where each user gets their own dedicated container, isolated workspace, and unique access URL.

## Architecture

**Multi-User System:**
```
User A → https://alice.example.com → Container A → /workspace/alice/
User B → https://bob.example.com   → Container B → /workspace/bob/
User C → https://carol.example.com → Container C → /workspace/carol/
```

**Key Features:**
- ✅ Each user gets dedicated container (no conflicts)
- ✅ Isolated workspace on EFS per user
- ✅ Unique password per user
- ✅ Auto-provisioning via API
- ✅ Auto-cleanup of idle environments (8h)
- ✅ Subdomain routing (alice.example.com)

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Domain name** for wildcard DNS (e.g., *.example.com)
3. **Docker** installed and running
4. **Node.js** 18+ and npm
5. **AWS CDK** installed globally
6. **Anthropic API Key**

## Step 1: Install Dependencies

```bash
cd claude_infra

# Install CDK dependencies
npm install

# Install Lambda dependencies
cd lambda/provisioning && npm install && cd ../..
cd lambda/cleanup && npm install && cd ../..
```

## Step 2: Build TypeScript

```bash
npm run build
```

## Step 3: Deploy Multi-User Stack

```bash
# Deploy multi-user infrastructure
npx cdk deploy -c multiUser=true

# Or for specific environment
npx cdk deploy -c multiUser=true -c env=production
```

**Deployment Time:** ~20 minutes

**What Gets Created:**
- VPC with 2 AZs, 2 NAT Gateways
- ECS Fargate Cluster
- Application Load Balancer
- EFS File System (shared, per-user access points)
- DynamoDB Tables (Users, Environments)
- Lambda Functions (Provisioning, Cleanup)
- API Gateway for user portal
- Secrets Manager (shared API key)
- CloudWatch Logs
- EventBridge Rule (hourly cleanup)

## Step 4: Configure API Key

After deployment, set the shared Anthropic API key:

```bash
# Get secret ARN from outputs
SHARED_API_KEY_SECRET=$(aws cloudformation describe-stacks \
  --stack-name dev-claude-multi-user-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`SharedApiKeySecretArn`].OutputValue' \
  --output text)

# Update with your API key
aws secretsmanager update-secret \
  --secret-id "$SHARED_API_KEY_SECRET" \
  --secret-string '{"apiKey":"sk-ant-YOUR_KEY_HERE"}'
```

## Step 5: Configure DNS

### Option A: Route53 (Recommended)

```bash
# Get ALB DNS name
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name dev-claude-multi-user-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

# Create hosted zone (if you don't have one)
aws route53 create-hosted-zone --name example.com --caller-reference $(date +%s)

# Get hosted zone ID
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name example.com \
  --query 'HostedZones[0].Id' \
  --output text | cut -d'/' -f3)

# Create wildcard A record
cat > /tmp/dns-change.json <<EOF
{
  "Changes": [{
    "Action": "CREATE",
    "ResourceRecordSet": {
      "Name": "*.example.com",
      "Type": "CNAME",
      "TTL": 300,
      "ResourceRecords": [{"Value": "$ALB_DNS"}]
    }
  }]
}
EOF

aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch file:///tmp/dns-change.json
```

### Option B: Manual DNS Setup

1. Go to your DNS provider (GoDaddy, Cloudflare, etc.)
2. Create a CNAME record:
   - **Name:** `*.example.com`
   - **Type:** CNAME
   - **Value:** `<ALB-DNS-NAME>` (from outputs)
   - **TTL:** 300

## Step 6: Set Up User Portal

### Option A: Host on S3 + CloudFront

```bash
# Create S3 bucket for portal
aws s3 mb s3://claude-portal-YOUR-ACCOUNT

# Enable static website hosting
aws s3 website s3://claude-portal-YOUR-ACCOUNT \
  --index-document index.html

# Upload portal
aws s3 cp portal/index.html s3://claude-portal-YOUR-ACCOUNT/

# Make public (or use CloudFront)
aws s3api put-bucket-policy \
  --bucket claude-portal-YOUR-ACCOUNT \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::claude-portal-YOUR-ACCOUNT/*"
    }]
  }'

# Get portal URL
echo "Portal URL: http://claude-portal-YOUR-ACCOUNT.s3-website-ap-northeast-1.amazonaws.com"
```

### Option B: Update Portal HTML

Edit `portal/index.html` and update:

```javascript
// Line ~250
const API_ENDPOINT = 'YOUR_API_GATEWAY_ENDPOINT_HERE';
```

Replace with your API Gateway endpoint from CDK outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name dev-claude-multi-user-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

## Step 7: Test the System

### Create First User Environment

```bash
# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name dev-claude-multi-user-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

# Request environment for user "alice"
curl -X POST ${API_ENDPOINT}dev/environments \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "alice",
    "email": "alice@example.com"
  }'
```

**Expected Response:**
```json
{
  "url": "http://alice.example.com",
  "password": "AbCdEfGh12345678...",
  "status": "provisioning",
  "environmentId": "env-1234567890",
  "note": "Environment is starting up. Please wait 1-2 minutes."
}
```

### Access the Environment

1. Wait 2 minutes for provisioning
2. Open `http://alice.example.com` in browser
3. Enter the password from the API response
4. You're in VS Code!

### Verify in Terminal

```bash
# Open VS Code terminal (Ctrl+`)
claude --version

# Test Claude Code
claude "write a hello world function in Python"

# Check workspace
pwd  # Should be /workspace
ls -la
```

## Step 8: Create Multiple Users

```bash
# Create environment for Bob
curl -X POST ${API_ENDPOINT}dev/environments \
  -H "Content-Type: application/json" \
  -d '{"userId": "bob", "email": "bob@example.com"}'

# Create environment for Carol
curl -X POST ${API_ENDPOINT}dev/environments \
  -H "Content-Type: application/json" \
  -d '{"userId": "carol", "email": "carol@example.com"}'

# Each user gets their own:
# - Subdomain (alice/bob/carol.example.com)
# - Container
# - EFS workspace
# - Password
```

## Monitoring

### View Active Environments

```bash
# List all environments
aws dynamodb scan \
  --table-name dev-claude-environments \
  --projection-expression "userId, #status, lastAccessedAt" \
  --expression-attribute-names '{"#status": "status"}' \
  --filter-expression "#status = :running" \
  --expression-attribute-values '{":running": {"S": "running"}}'
```

### Check User's Environment

```bash
# Get specific user environment
curl ${API_ENDPOINT}dev/environments/alice
```

### View Logs

```bash
# View provisioning logs
aws logs tail /aws/lambda/dev-claude-multi-user-stack-ProvisioningLambda --follow

# View cleanup logs
aws logs tail /aws/lambda/dev-claude-multi-user-stack-CleanupLambda --follow

# View container logs
aws logs tail /ecs/dev-claude-multi-user --follow
```

### Monitor Costs

```bash
# Get running task count
aws ecs describe-services \
  --cluster dev-claude-multi-user-cluster \
  --services $(aws ecs list-services \
    --cluster dev-claude-multi-user-cluster \
    --query 'serviceArns' --output text) \
  --query 'services[*].[serviceName, runningCount]' \
  --output table
```

## Auto-Cleanup Behavior

**Automatic Idle Cleanup:**
- Runs every hour via EventBridge
- Stops environments idle for 8+ hours
- Preserves EFS data (files safe!)
- Preserves password (can restart)

**What Gets Stopped:**
- ECS Task
- Target Group
- ALB Listener Rule

**What's Preserved:**
- EFS Access Point (files)
- Password Secret
- DynamoDB record (status = stopped)

**Restarting:**
User requests environment again → Lambda detects stopped state → Provisions new task with same EFS/password

## User Management

### List All Users

```bash
aws dynamodb scan \
  --table-name dev-claude-users \
  --projection-expression "userId, email, createdAt, #status" \
  --expression-attribute-names '{"#status": "status"}'
```

### Suspend User

```bash
aws dynamodb update-item \
  --table-name dev-claude-users \
  --key '{"userId": {"S": "alice"}}' \
  --update-expression "SET #status = :suspended" \
  --expression-attribute-names '{"#status": "status"}' \
  --expression-attribute-values '{":suspended": {"S": "suspended"}}'
```

### Delete User (and cleanup resources)

```bash
# Stop their environment
curl -X DELETE ${API_ENDPOINT}dev/environments/alice

# Delete user record
aws dynamodb delete-item \
  --table-name dev-claude-users \
  --key '{"userId": {"S": "alice"}}'
```

## Production Considerations

### 1. Add HTTPS

Update the CDK stack to add ACM certificate:

```typescript
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

// Request certificate (or import existing)
const certificate = new acm.Certificate(this, 'Certificate', {
  domainName: '*.example.com',
  validation: acm.CertificateValidation.fromDns(),
});

// Add HTTPS listener
const httpsListener = alb.addListener('HttpsListener', {
  port: 443,
  protocol: elbv2.ApplicationProtocol.HTTPS,
  certificates: [certificate],
  defaultAction: elbv2.ListenerAction.fixedResponse(404),
});

// Redirect HTTP to HTTPS
httpListener.addAction('RedirectToHttps', {
  action: elbv2.ListenerAction.redirect({
    protocol: 'HTTPS',
    port: '443',
    permanent: true,
  }),
});
```

### 2. Add Authentication

Options:
- **AWS Cognito** - Built-in user pools
- **OAuth2 Proxy** - SSO with Google/GitHub
- **API Keys** - Simple token-based auth

### 3. Resource Quotas

Set limits per user:

```typescript
// In DynamoDB
{
  userId: 'alice',
  quota: {
    maxEnvironments: 3,
    maxCpu: 4096,
    maxMemory: 8192,
  }
}
```

### 4. Cost Allocation Tags

```bash
# Tag resources by user for cost tracking
aws resourcegroupstaggingapi tag-resources \
  --resource-arn-list <task-arn> \
  --tags UserId=alice,CostCenter=engineering
```

### 5. Monitoring & Alerting

```bash
# Create CloudWatch alarm for high user count
aws cloudwatch put-metric-alarm \
  --alarm-name too-many-users \
  --alarm-description "Alert when > 50 users active" \
  --metric-name RunningTaskCount \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

## Scaling Limits

| Resource | Soft Limit | Hard Limit | Action |
|----------|------------|------------|--------|
| ALB Rules | 100 | 100 | Use path-based or multiple ALBs |
| EFS Access Points | 1000 | 10,000 | Request increase |
| DynamoDB RCU/WCU | Unlimited | Unlimited | Pay per request |
| Fargate Tasks | 500 per region | 10,000 | Request increase |

**For 100+ users**, consider:
- Multiple ALBs (100 users each)
- Multiple EFS file systems (1000 users each)
- Regional distribution
- Reserved Capacity for cost savings

## Troubleshooting

### User Can't Access Environment

1. Check DNS resolution:
   ```bash
   nslookup alice.example.com
   ```

2. Check ALB rule exists:
   ```bash
   aws elbv2 describe-rules \
     --listener-arn <listener-arn> \
     --query 'Rules[?Conditions[0].Values[0]==`alice.*`]'
   ```

3. Check task is running:
   ```bash
   aws dynamodb get-item \
     --table-name dev-claude-environments \
     --key '{"userId": {"S": "alice"}}'
   ```

### Provisioning Fails

Check Lambda logs:
```bash
aws logs tail /aws/lambda/dev-claude-multi-user-stack-ProvisioningLambda \
  --since 10m
```

Common issues:
- EFS Access Point limit reached
- ALB rule priority conflict
- Task definition not found
- Insufficient IAM permissions

### Auto-Cleanup Not Working

Check cleanup Lambda:
```bash
# Invoke manually
aws lambda invoke \
  --function-name dev-claude-multi-user-stack-CleanupLambda \
  /tmp/output.json

cat /tmp/output.json
```

## Cost Estimate

**Per Active User (24/7):**
- Fargate (2 vCPU, 4GB): $60/month
- EFS Storage (10GB): $3/month
- Secrets: $0.40/month
- **Total: ~$63/user/month**

**Shared Costs:**
- NAT Gateways (2x): $70/month
- ALB: $20/month
- DynamoDB: ~$5/month
- Lambda: ~$1/month
- **Total: ~$96/month**

**Total for 10 Users (24/7):**
- User costs: $630
- Shared costs: $96
- **Total: $726/month**

**With Auto-Stop (4h/day avg):**
- User costs: ~$105 (83% savings)
- Shared costs: $96
- **Total: $201/month (72% savings!)**

## Cleanup

### Delete Everything

```bash
npx cdk destroy -c multiUser=true
```

**Manual Cleanup (if needed):**
```bash
# Delete EFS access points
aws efs describe-access-points \
  --file-system-id <fs-id> \
  --query 'AccessPoints[*].AccessPointId' \
  --output text | \
  xargs -n1 aws efs delete-access-point --access-point-id

# Delete secrets
aws secretsmanager list-secrets \
  --query 'SecretList[?contains(Name, `claude-code`)].Name' \
  --output text | \
  xargs -n1 aws secretsmanager delete-secret --secret-id --force-delete-without-recovery
```

## Next Steps

1. **Test with 2-3 users** to validate functionality
2. **Set up monitoring** and alerting
3. **Add HTTPS** with ACM certificate
4. **Configure auto-stop** based on your usage patterns
5. **Set up backups** for DynamoDB tables
6. **Implement user authentication** for production
7. **Document onboarding** process for new users

## Support

For issues:
- Check CloudWatch logs
- Review DynamoDB tables
- Test API Gateway endpoints manually
- Verify DNS configuration

## Summary

You now have a fully functional multi-user Claude Code infrastructure! Each user can request their own environment, which gets automatically provisioned with isolated resources and auto-cleanup.

**Key Benefits:**
- ✅ True multi-user support
- ✅ Automatic provisioning (2 min)
- ✅ Cost optimization with auto-stop
- ✅ Secure isolation per user
- ✅ Scales to 100+ users
