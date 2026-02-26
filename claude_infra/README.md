# Claude Code Remote Development Environment

This CDK stack deploys **code-server** (VS Code in the browser) on AWS ECS Fargate with **Claude Code CLI** pre-installed, providing a cloud-based remote development environment.

## Architecture

The infrastructure includes:

- **VPC**: Custom VPC with 2 AZs, public and private subnets, NAT Gateway
- **ECS Fargate**: Serverless containers running code-server (2 vCPU, 4GB RAM)
- **Application Load Balancer**: Public endpoint for accessing code-server
- **Amazon EFS**: Persistent storage for workspace files (survives container restarts)
- **CloudWatch Logs**: Centralized logging with 1-week retention
- **AWS Secrets Manager**: Secure storage for Anthropic API key and code-server password
- **Auto-scaling**: CPU-based scaling (1-5 instances)

## What You Get

- **VS Code in Browser**: Full VS Code experience accessible from any web browser
- **Claude Code CLI**: Pre-installed and ready to use in the integrated terminal
- **Persistent Storage**: Your work is saved to EFS and persists across sessions
- **Pre-installed Tools**: Git, Node.js 20, Python 3, build tools
- **VS Code Extensions**: Python, ESLint, Prettier, GitLens pre-installed
- **Password Protected**: Secure access with automatically generated password

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Node.js** (v18 or later) and **npm**
3. **Docker** installed and running
4. **AWS CDK CLI**: `npm install -g aws-cdk`
5. **Anthropic API Key**: Get one from https://console.anthropic.com/

## Installation

### 1. Install Dependencies

```bash
cd claude_infra
npm install
```

### 2. Build TypeScript

```bash
npm run build
```

### 3. Bootstrap CDK (First time only)

If you haven't used CDK in this AWS account/region before:

```bash
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

Example:
```bash
npx cdk bootstrap aws://187326049035/ap-northeast-1
```

## Deployment

### 1. Deploy the Stack

```bash
# Deploy to dev environment (default)
npx cdk deploy

# Or deploy to a specific environment
npx cdk deploy -c env=production
```

**Note**: Deployment takes approximately 15-20 minutes due to Docker image build and EFS provisioning.

### 2. Get Your Password

After deployment, retrieve the auto-generated password:

```bash
aws secretsmanager get-secret-value \
  --secret-id dev-code-server-password \
  --query SecretString \
  --output text
```

Save this password - you'll need it to log into code-server.

### 3. Configure Anthropic API Key

Update the API key secret:

```bash
aws secretsmanager update-secret \
  --secret-id dev-claude-api-key \
  --secret-string '{"apiKey":"YOUR_ANTHROPIC_API_KEY_HERE"}'
```

### 4. Restart Service (to pick up API key)

```bash
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --force-new-deployment
```

Wait 2-3 minutes for the new tasks to become healthy.

## Accessing Your Development Environment

### 1. Get the URL

```bash
CODE_SERVER_URL=$(aws cloudformation describe-stacks \
  --stack-name dev-claude-infra-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`CodeServerURL`].OutputValue' \
  --output text)

echo "Access code-server at: $CODE_SERVER_URL"
```

### 2. Open in Browser

1. Open the URL in your web browser
2. Enter the password you retrieved earlier
3. You'll see VS Code running in your browser!

### 3. Use Claude Code

Open the integrated terminal in VS Code (`` Ctrl+` `` or `Terminal > New Terminal`) and run:

```bash
# Check Claude Code is installed
claude --version

# Set your API key (already configured via environment variable)
# But if needed, you can also set it manually:
export ANTHROPIC_API_KEY="your-key-here"

# Start using Claude Code
claude "help me write a Python function to calculate fibonacci numbers"
```

## Using the Development Environment

### Working with Files

All files in the `/workspace` directory are persisted to EFS:

```bash
cd /workspace

# Clone a repository
git clone https://github.com/your-username/your-repo.git
cd your-repo

# Use Claude Code for development
claude "help me refactor this code"
```

### Installing Additional Tools

You have sudo access in the container:

```bash
# Install additional packages
sudo apt-get update
sudo apt-get install -y <package-name>

# Install global npm packages
npm install -g <package-name>

# Install Python packages
pip3 install <package-name>
```

### VS Code Extensions

Install additional extensions:
1. Click the Extensions icon in the sidebar (or `Ctrl+Shift+X`)
2. Search and install extensions
3. Extensions are installed per-container (will need reinstall if container recreates)

## Testing

### Health Check

```bash
LOAD_BALANCER_DNS=$(aws cloudformation describe-stacks \
  --stack-name dev-claude-infra-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

curl http://$LOAD_BALANCER_DNS/healthz
```

Expected: HTTP 200 OK

### View Logs

```bash
aws logs tail /ecs/dev-claude-code --follow
```

### Check Service Status

```bash
aws ecs describe-services \
  --cluster dev-claude-cluster \
  --services dev-claude-service \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

### Verify EFS Mount

In the code-server terminal:

```bash
df -h | grep workspace
```

You should see the EFS file system mounted at `/workspace`.

## Monitoring

### CloudWatch Metrics

View metrics in AWS Console:
1. Navigate to CloudWatch → Metrics → ECS
2. Select your cluster: `dev-claude-cluster`
3. View CPU, memory, and network metrics

### Container Insights

1. CloudWatch → Container Insights → Performance monitoring
2. Select "ECS Services" view
3. Choose your cluster and service

### Logs

```bash
# Tail logs
aws logs tail /ecs/dev-claude-code --follow

# Search logs
aws logs filter-log-events \
  --log-group-name /ecs/dev-claude-code \
  --filter-pattern "ERROR"
```

## Cost Estimation

Approximate monthly costs (ap-northeast-1, 24/7 operation):

- **Fargate Tasks** (1 task, 2 vCPU, 4GB): ~$60/month
- **NAT Gateway**: ~$35/month
- **Application Load Balancer**: ~$20/month
- **EFS Storage** (assuming 10GB): ~$3/month
- **CloudWatch Logs** (10GB): ~$5/month

**Total**: ~$120-130/month for 24/7 operation

### Cost Optimization Tips

1. **Scale to zero during off-hours**:
   ```bash
   aws ecs update-service \
     --cluster dev-claude-cluster \
     --service dev-claude-service \
     --desired-count 0
   ```

2. **Use CloudWatch Events** to schedule scaling

3. **Remove NAT Gateway** for dev (use public subnets)

4. **Use Fargate Spot** for non-production (70% cost savings)

## Security

### Access Control

- **Password Authentication**: code-server is password-protected
- **Network**: Services run in private subnets
- **Secrets**: API keys stored in AWS Secrets Manager
- **IAM**: Least-privilege task role permissions

### Improving Security

1. **Add HTTPS**: Configure ACM certificate on ALB
2. **Add WAF**: Deploy AWS WAF for additional protection
3. **IP Whitelisting**: Restrict ALB access to specific IPs
4. **OAuth**: Configure code-server for OAuth2 authentication

Example: Restrict access to your IP:

```bash
# Get ALB security group
ALB_SG=$(aws ec2 describe-security-groups \
  --filters "Name=tag:aws:cloudformation:logical-id,Values=ClaudeServiceLBSecurityGroup" \
  --query 'SecurityGroups[0].GroupId' \
  --output text)

# Add your IP
aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG \
  --protocol tcp \
  --port 80 \
  --cidr YOUR_IP/32
```

## Troubleshooting

### Can't Access code-server

1. **Check service is running**:
   ```bash
   aws ecs describe-services \
     --cluster dev-claude-cluster \
     --services dev-claude-service
   ```

2. **Check task logs**:
   ```bash
   aws logs tail /ecs/dev-claude-code --follow
   ```

3. **Verify health check**:
   ```bash
   curl http://$LOAD_BALANCER_DNS/healthz
   ```

### Wrong Password

Retrieve the password again:

```bash
aws secretsmanager get-secret-value \
  --secret-id dev-code-server-password \
  --query SecretString \
  --output text
```

### Claude Code Not Working

1. **Verify API key is set**:
   ```bash
   # In code-server terminal
   echo $ANTHROPIC_API_KEY
   ```

2. **Check API key in Secrets Manager**:
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id dev-claude-api-key
   ```

3. **Restart service** after updating API key

### Files Not Persisting

1. **Verify EFS is mounted**:
   ```bash
   # In code-server terminal
   df -h | grep workspace
   ```

2. **Check EFS permissions**:
   ```bash
   ls -la /workspace
   ```

3. **Verify you're working in /workspace**, not `/home/developer`

## Customization

### Change Password

```bash
# Update the secret with a new password
aws secretsmanager update-secret \
  --secret-id dev-code-server-password \
  --secret-string "YourNewPassword123"

# Restart service
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --force-new-deployment
```

### Change Instance Size

Edit `lib/claude-infra-stack.ts`:

```typescript
const taskDefinition = new ecs.FargateTaskDefinition(this, 'ClaudeTaskDef', {
  memoryLimitMiB: 8192,  // Increase to 8GB
  cpu: 4096,              // Increase to 4 vCPU
  // ...
});
```

Then redeploy:
```bash
npm run build && npx cdk deploy
```

### Add VS Code Extensions to Dockerfile

Edit `Dockerfile`:

```dockerfile
# Install additional VS Code extensions
RUN code-server --install-extension ms-python.python && \
    code-server --install-extension dbaeumer.vscode-eslint && \
    code-server --install-extension your-extension-id
```

### Use Existing VPC

Edit `lib/claude-infra-stack.ts`:

```typescript
// Instead of creating new VPC, use existing one
const vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
  vpcId: 'vpc-xxxxx',
});
```

## Multi-User Setup

For multiple developers, consider:

1. **Separate Stacks per User**:
   ```bash
   npx cdk deploy -c env=dev-user1
   npx cdk deploy -c env=dev-user2
   ```

2. **Different Passwords**: Each stack gets its own password secret

3. **Shared EFS** (optional): Use existing EFS with different access points

4. **Cost Allocation Tags**: Tag resources by user for cost tracking

## Cleanup

### Delete the Stack

```bash
npx cdk destroy

# Confirm deletion
```

This removes:
- ECS cluster and services
- Load balancer
- VPC and networking
- CloudWatch log groups
- Secrets

**Note**: EFS file system is set to DELETE on stack removal. If you want to keep your files, change `removalPolicy` to `RETAIN` before destroying.

### Manual Cleanup (if needed)

```bash
# Delete EFS file system (if retained)
aws efs delete-file-system --file-system-id fs-xxxxx

# Delete ECR images
aws ecr list-images --repository-name cdk-<hash>-container-assets-<account>-<region>
aws ecr batch-delete-image --repository-name <repo> --image-ids imageTag=<tag>
```

## CI/CD Integration

### GitHub Actions Example

Create `.github/workflows/deploy-claude-infra.yml`:

```yaml
name: Deploy Claude Infra

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd claude_infra
          npm install

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-northeast-1

      - name: Deploy to AWS
        run: |
          cd claude_infra
          npm run build
          npx cdk deploy --require-approval never
```

## FAQ

### Can multiple users share one environment?

Code-server supports one user at a time. For multiple users, deploy separate stacks.

### How do I upgrade Claude Code?

Rebuild the Docker image with the latest version:
```bash
npm run build
npx cdk deploy
```

### Can I use this for production work?

Yes, but consider:
- Adding HTTPS with ACM
- Implementing better authentication (OAuth)
- Regular backups of EFS
- Monitoring and alerting

### What happens if the container restarts?

Files in `/workspace` persist (stored on EFS). Other files and installed packages may be lost.

### Can I access this from mobile?

Yes! code-server works on mobile browsers, though the experience is better on desktop.

## Support and Resources

- **code-server**: https://github.com/coder/code-server
- **Claude Code**: https://github.com/anthropics/claude-code
- **AWS CDK**: https://docs.aws.amazon.com/cdk/
- **Issues**: Report at your repository's issue tracker

## License

This infrastructure code is part of the Jericho Security project.
