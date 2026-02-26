# Claude Code Remote Development Environment - Quick Reference

This stack deploys code-server (VS Code in browser) with Claude Code CLI on AWS ECS Fargate.

## Stack Overview

- **Purpose**: Cloud-based remote development environment with Claude Code
- **Technology**: code-server, AWS CDK (TypeScript), ECS Fargate, EFS, ALB
- **Region**: ap-northeast-1 (Tokyo) by default

## Key Components

### Infrastructure

- **VPC**: 2 AZs, public/private subnets, NAT Gateway
- **ECS Fargate**: 2 vCPU, 4GB RAM per task
- **EFS**: Persistent workspace storage across restarts
- **ALB**: Load balancer for accessing code-server
- **Secrets Manager**: Stores API key and code-server password
- **Auto-scaling**: 1-5 tasks based on CPU (80% target)

### Application

- **code-server**: VS Code 1.96+ in browser
- **Claude Code CLI**: Latest version pre-installed
- **Node.js**: v20 LTS
- **Python**: 3.10+
- **Tools**: git, build-essential, curl, wget
- **Extensions**: Python, ESLint, Prettier, GitLens

## Quick Start

```bash
# Install and build
npm install && npm run build

# Bootstrap (first time only)
npx cdk bootstrap

# Deploy
npx cdk deploy

# Get password
aws secretsmanager get-secret-value \
  --secret-id dev-code-server-password \
  --query SecretString --output text

# Set API key
aws secretsmanager update-secret \
  --secret-id dev-claude-api-key \
  --secret-string '{"apiKey":"sk-ant-xxx"}'

# Restart to apply API key
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --force-new-deployment

# Get URL
aws cloudformation describe-stacks \
  --stack-name dev-claude-infra-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`CodeServerURL`].OutputValue' \
  --output text
```

## Common Commands

### Development

```bash
# Build TypeScript
npm run build

# Watch mode
npm run watch

# Synth CloudFormation
npx cdk synth

# Preview changes
npx cdk diff

# Deploy
npx cdk deploy

# Destroy
npx cdk destroy
```

### Access Management

```bash
# Get code-server URL
URL=$(aws cloudformation describe-stacks \
  --stack-name dev-claude-infra-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`CodeServerURL`].OutputValue' \
  --output text)
echo $URL

# Get password
aws secretsmanager get-secret-value \
  --secret-id dev-code-server-password \
  --query SecretString --output text

# Change password
aws secretsmanager update-secret \
  --secret-id dev-code-server-password \
  --secret-string "NewPassword123"

# Update API key
aws secretsmanager update-secret \
  --secret-id dev-claude-api-key \
  --secret-string '{"apiKey":"sk-ant-YOUR_KEY"}'
```

### Service Management

```bash
# Check service status
aws ecs describe-services \
  --cluster dev-claude-cluster \
  --services dev-claude-service \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'

# Restart service (after config changes)
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --force-new-deployment

# Scale manually
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --desired-count 2

# Scale to zero (save costs)
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --desired-count 0

# List running tasks
aws ecs list-tasks \
  --cluster dev-claude-cluster \
  --service-name dev-claude-service

# Get task details
TASK_ARN=$(aws ecs list-tasks \
  --cluster dev-claude-cluster \
  --service-name dev-claude-service \
  --query 'taskArns[0]' --output text)

aws ecs describe-tasks \
  --cluster dev-claude-cluster \
  --tasks $TASK_ARN
```

### Monitoring & Logs

```bash
# Tail logs
aws logs tail /ecs/dev-claude-code --follow

# Filter errors
aws logs filter-log-events \
  --log-group-name /ecs/dev-claude-code \
  --filter-pattern "ERROR"

# Check EFS status
aws efs describe-file-systems \
  --file-system-id $(aws cloudformation describe-stacks \
    --stack-name dev-claude-infra-stack \
    --query 'Stacks[0].Outputs[?OutputKey==`FileSystemId`].OutputValue' \
    --output text)

# View metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=dev-claude-service Name=ClusterName,Value=dev-claude-cluster \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average
```

### Testing

```bash
# Test health endpoint
LOAD_BALANCER=$(aws cloudformation describe-stacks \
  --stack-name dev-claude-infra-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

curl -I http://$LOAD_BALANCER/healthz

# Test from ECS Exec (if enabled)
aws ecs execute-command \
  --cluster dev-claude-cluster \
  --task $TASK_ARN \
  --container ClaudeContainer \
  --interactive \
  --command "/bin/bash"
```

## Using Claude Code in code-server

### In the Terminal

```bash
# Navigate to workspace
cd /workspace

# Use Claude Code
claude "help me write a function"

# Interactive mode
claude

# With context from files
claude "refactor this code" -f main.py

# Git integration
git clone https://github.com/user/repo.git
cd repo
claude "explain this codebase"
```

### API Key Configuration

The API key is automatically set via environment variable `ANTHROPIC_API_KEY`. You can verify:

```bash
echo $ANTHROPIC_API_KEY
```

If needed, you can override it:

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

### Workspace Persistence

- **All files in `/workspace` are persisted to EFS**
- Files survive container restarts
- Other directories (`/tmp`, `/home/developer`) are ephemeral
- Always work in `/workspace` for persistence

## Architecture Notes

### Why EFS?

- Persistent storage across task restarts
- Shared storage (can be used for multi-user with different access points)
- Automatic backups with lifecycle policies
- Encrypted at rest

### Why 2 vCPU / 4GB RAM?

- code-server needs ~1GB RAM
- Claude Code API calls are lightweight
- Extra headroom for development tasks
- Can be adjusted based on workload

### Why Private Subnets?

- Security: Tasks not directly exposed
- NAT Gateway for outbound HTTPS (Claude API)
- ALB handles inbound traffic
- Defense in depth

### Auto-scaling Strategy

- Min: 1 task (always available)
- Max: 5 tasks (reasonable for small teams)
- Target: 80% CPU
- Scale-out: 5 minutes
- Scale-in: 10 minutes (avoid thrashing)

For production with multiple users, consider:
- Fixed capacity per user (no auto-scaling)
- Separate stack per user or team
- Application-level load balancing

## Security Best Practices

### Implemented

- ✅ Password authentication
- ✅ Private subnets for tasks
- ✅ Secrets in AWS Secrets Manager
- ✅ Encrypted EFS
- ✅ IAM least privilege
- ✅ Container runs as non-root user
- ✅ Security groups configured

### Recommended Additions

- 🔲 Add HTTPS with ACM certificate
- 🔲 Enable OAuth2 authentication
- 🔲 Restrict ALB to specific IPs
- 🔲 Enable AWS WAF
- 🔲 Set up CloudWatch alarms
- 🔲 Enable VPC Flow Logs
- 🔲 Regular security scanning

### Adding HTTPS

1. Request certificate in ACM
2. Update stack to add certificate to ALB
3. Add HTTP → HTTPS redirect

```typescript
// In lib/claude-infra-stack.ts
const cert = acm.Certificate.fromCertificateArn(this, 'Cert', 'arn:...');

const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(
  this, 'ClaudeService', {
    // ...
    certificate: cert,
    redirectHTTP: true,
  }
);
```

## Cost Optimization

### Current Costs (~$120/month 24/7)

- Fargate: $60 (2 vCPU, 4GB, 730 hours)
- NAT Gateway: $35
- ALB: $20
- EFS: $3 (10GB)
- Logs: $5

### Optimization Strategies

1. **Scale to zero during off-hours**:
   ```bash
   # 6 PM - scale down
   aws ecs update-service --cluster dev-claude-cluster \
     --service dev-claude-service --desired-count 0

   # 9 AM - scale up
   aws ecs update-service --cluster dev-claude-cluster \
     --service dev-claude-service --desired-count 1
   ```

2. **Use Fargate Spot** (70% cheaper):
   ```typescript
   capacityProviderStrategies: [
     {
       capacityProvider: 'FARGATE_SPOT',
       weight: 1,
     },
   ]
   ```

3. **Remove NAT Gateway** (dev only):
   - Use public subnets for tasks
   - Assign public IP
   - Saves $35/month

4. **Scheduled Scaling** with CloudWatch Events

5. **Right-size**: Use 1 vCPU / 2GB if sufficient

## Troubleshooting

### Service Won't Start

Check logs:
```bash
aws logs tail /ecs/dev-claude-code --follow | grep -i error
```

Common issues:
- Docker image build failed
- EFS mount timeout
- Secrets not accessible
- Insufficient permissions

### Can't Connect to code-server

1. Check task is running:
   ```bash
   aws ecs describe-services \
     --cluster dev-claude-cluster \
     --services dev-claude-service
   ```

2. Check target group health:
   ```bash
   TG_ARN=$(aws elbv2 describe-target-groups \
     --names dev-claude-infra-stack-ClaudeServiceLB* \
     --query 'TargetGroups[0].TargetGroupArn' --output text)

   aws elbv2 describe-target-health --target-group-arn $TG_ARN
   ```

3. Test health endpoint directly:
   ```bash
   curl -I http://$LOAD_BALANCER/healthz
   ```

### Claude Code Not Working

1. Verify API key:
   ```bash
   aws secretsmanager get-secret-value --secret-id dev-claude-api-key
   ```

2. Check in container:
   ```bash
   # In code-server terminal
   echo $ANTHROPIC_API_KEY
   claude --version
   ```

3. Test API key manually:
   ```bash
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "content-type: application/json" \
     -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
   ```

### Files Not Saving

1. Check EFS mount:
   ```bash
   df -h | grep workspace
   ```

2. Check permissions:
   ```bash
   ls -la /workspace
   ```

3. Verify you're in /workspace:
   ```bash
   pwd
   ```

## Customization Examples

### Add More VS Code Extensions

Edit `Dockerfile`:

```dockerfile
RUN code-server --install-extension golang.go && \
    code-server --install-extension rust-lang.rust-analyzer
```

### Change Instance Size

Edit `lib/claude-infra-stack.ts`:

```typescript
const taskDefinition = new ecs.FargateTaskDefinition(this, 'ClaudeTaskDef', {
  memoryLimitMiB: 8192,  // 8GB
  cpu: 4096,              // 4 vCPU
});
```

### Use Existing VPC

```typescript
const vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
  vpcId: 'vpc-xxxxx',
});
```

### Multiple Environments

```bash
npx cdk deploy -c env=prod
npx cdk deploy -c env=staging
```

## Development Workflow

1. Make code changes in `lib/` or `Dockerfile`
2. Build: `npm run build`
3. Test locally: `npx cdk synth`
4. Preview: `npx cdk diff`
5. Deploy: `npx cdk deploy`
6. Test access: Open URL in browser
7. Check logs: `aws logs tail /ecs/dev-claude-code --follow`
8. Iterate

## Future Enhancements

### Potential Features

- [ ] HTTPS with ACM
- [ ] Custom domain with Route53
- [ ] OAuth2 authentication
- [ ] ECS Exec for debugging
- [ ] CloudWatch alarms
- [ ] Automated backups of EFS
- [ ] Multi-user with separate access points
- [ ] CI/CD pipeline for updates
- [ ] Fargate Spot for cost savings
- [ ] VPC endpoints (replace NAT Gateway)

### Multi-User Architecture

For teams, consider:

1. **Separate stacks per user**:
   - Isolated environments
   - Per-user billing
   - Independent scaling

2. **Shared EFS with access points**:
   - Single EFS
   - Per-user access point
   - Shared data possible

3. **Application-level routing**:
   - Single ALB
   - Path-based routing
   - User session management

## References

- Stack code: `lib/claude-infra-stack.ts`
- Dockerfile: `Dockerfile`
- Full docs: `README.md`
- code-server: https://github.com/coder/code-server
- Claude Code: https://github.com/anthropics/claude-code
