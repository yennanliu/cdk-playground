# Quick Deployment Guide

Follow these steps to deploy the Claude Code remote development environment.

## Pre-Deployment Checklist

- [ ] AWS CLI configured
- [ ] Docker Desktop running
- [ ] Node.js 18+ installed
- [ ] Have Anthropic API key ready
- [ ] AWS account has been bootstrapped for CDK

## Step-by-Step Deployment

### 1. Start Docker

```bash
# Make sure Docker is running
docker info
```

If Docker isn't running, start Docker Desktop.

### 2. Install Dependencies

```bash
cd claude_infra
npm install
```

### 3. Build TypeScript

```bash
npm run build
```

### 4. Bootstrap CDK (First Time Only)

```bash
# Get your AWS account ID
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# Bootstrap for ap-northeast-1
npx cdk bootstrap aws://$AWS_ACCOUNT/ap-northeast-1
```

### 5. Deploy the Stack

```bash
npx cdk deploy
```

**Expected time**: 15-20 minutes

**What happens**:
- Builds Docker image with code-server and Claude Code
- Creates VPC with networking
- Sets up EFS for storage
- Launches ECS Fargate service
- Configures load balancer
- Creates secrets for API key and password

### 6. Get Your Password

```bash
PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id dev-code-server-password \
  --query SecretString \
  --output text)

echo "Your code-server password: $PASSWORD"
```

**Save this password!** You'll need it to log in.

### 7. Set Your Anthropic API Key

```bash
aws secretsmanager update-secret \
  --secret-id dev-claude-api-key \
  --secret-string '{"apiKey":"sk-ant-YOUR_KEY_HERE"}'
```

Replace `sk-ant-YOUR_KEY_HERE` with your actual API key from https://console.anthropic.com/

### 8. Restart the Service

```bash
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --force-new-deployment
```

Wait 2-3 minutes for the new tasks to become healthy.

### 9. Get Your Access URL

```bash
CODE_SERVER_URL=$(aws cloudformation describe-stacks \
  --stack-name dev-claude-infra-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`CodeServerURL`].OutputValue' \
  --output text)

echo "Access your development environment at: $CODE_SERVER_URL"
```

### 10. Access code-server

1. Open the URL in your web browser
2. Enter the password from step 6
3. You're in! VS Code is now running in your browser

### 11. Test Claude Code

In the code-server terminal (`` Ctrl+` `` or Terminal > New Terminal):

```bash
# Verify Claude Code is installed
claude --version

# Test it out
claude "write a hello world function in Python"
```

## Post-Deployment

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

### Monitor Costs

- View costs in AWS Cost Explorer
- Expected: ~$120/month for 24/7 operation
- See README.md for cost optimization tips

## Common Issues

### Docker not running

**Error**: Cannot connect to Docker daemon

**Solution**: Start Docker Desktop

### CDK not bootstrapped

**Error**: Need to perform AWS CDK bootstrap

**Solution**: Run `npx cdk bootstrap aws://$ACCOUNT_ID/ap-northeast-1`

### Can't access URL

**Error**: Connection refused or timeout

**Solution**: Wait 2-3 minutes after deployment for tasks to become healthy. Check service status with:

```bash
aws ecs describe-services \
  --cluster dev-claude-cluster \
  --services dev-claude-service
```

### Wrong password

**Solution**: Retrieve it again:

```bash
aws secretsmanager get-secret-value \
  --secret-id dev-code-server-password \
  --query SecretString \
  --output text
```

## Cleanup

To remove all resources and stop billing:

```bash
npx cdk destroy
```

Confirm with 'y' when prompted.

**Note**: This will delete:
- All infrastructure
- The EFS file system (and your files!)
- Secrets and passwords

## Next Steps

- Read the full `README.md` for detailed information
- Check `CLAUDE.md` for common commands and troubleshooting
- Customize the stack for your needs
- Set up HTTPS with a custom domain
- Configure scheduled scaling to reduce costs

## Getting Help

If you encounter issues:

1. Check the logs: `aws logs tail /ecs/dev-claude-code --follow`
2. Review the troubleshooting section in `README.md`
3. Check CDK synthesis: `npx cdk synth`
4. Verify AWS credentials: `aws sts get-caller-identity`

## Security Reminders

- [ ] Change the auto-generated password to something memorable
- [ ] Restrict ALB access to your IP if possible
- [ ] Never commit your API key to git
- [ ] Enable MFA on your AWS account
- [ ] Review IAM permissions regularly
- [ ] Consider adding HTTPS for production use

## Cost Optimization

To reduce costs, scale down when not in use:

```bash
# Stop all tasks (costs ~$60/month less)
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --desired-count 0

# Restart when needed
aws ecs update-service \
  --cluster dev-claude-cluster \
  --service dev-claude-service \
  --desired-count 1
```

NAT Gateway and ALB will still incur costs (~$55/month).

For maximum savings, destroy the stack when not in use and redeploy when needed (EFS files will be lost unless you change the removal policy).
