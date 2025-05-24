# Airflow ECS CDK Deployment

This CDK project deploys Apache Airflow on AWS ECS Fargate with the minimal necessary infrastructure.

## Architecture

- **ECS Fargate**: Single container running Airflow webserver + scheduler
- **RDS PostgreSQL**: Database for Airflow metadata (t3.micro for cost optimization)
- **Application Load Balancer**: Public access to Airflow UI
- **VPC**: Minimal setup with public and private subnets (single NAT gateway)

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js (>=14.x)
- CDK CLI installed (`npm install -g aws-cdk`)

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Bootstrap CDK (if first time):**
   ```bash
   cdk bootstrap
   ```

3. **Deploy the stack:**
   ```bash
   cdk deploy
   ```

4. **Access Airflow:**
   - URL will be provided in the deployment output
   - Default credentials: `admin` / `admin123`

## Configuration

### Single Node Setup
- Uses `LocalExecutor` for simplicity
- Both webserver and scheduler run in the same container
- Suitable for development and small workloads

### Database
- PostgreSQL 15 on RDS t3.micro
- No backups configured for cost savings
- Auto-generated credentials stored in AWS Secrets Manager

### Security
- ECS tasks run in private subnets
- Only ALB is publicly accessible
- Security groups limit traffic between components
- **Note**: Change the Fernet key in production!

## Customization

### Resource Sizing
Edit `lib/airflow-ecs-2-stack.ts`:
- ECS task: `memoryLimitMiB` and `cpu`
- RDS instance: `instanceType`

### Airflow Configuration
Modify environment variables in the ECS container definition:
- `AIRFLOW__CORE__EXECUTOR`
- `AIRFLOW__CORE__LOAD_EXAMPLES`
- etc.

## Cleanup

```bash
cdk destroy
```

**Warning**: This will delete all resources including the database. Make sure to backup any important data first.

## Cost Optimization

This setup is optimized for minimal cost:
- t3.micro RDS instance
- Single NAT gateway
- Minimal ECS resources (1 vCPU, 2GB RAM)
- No RDS backups

## Production Considerations

For production use, consider:
- Separate webserver and scheduler services
- Multiple AZs for high availability
- RDS backups and encryption
- Custom Fernet key
- SSL/TLS termination
- Monitoring and logging
- Auto-scaling configuration

## Troubleshooting

1. **Service fails to start**: Check CloudWatch logs at `/ecs/airflow`
2. **Database connection issues**: Verify security group rules and ensure RDS is in AVAILABLE state
3. **ALB health checks failing**: Ensure container starts properly and port 8080 is accessible
4. **Database initialization errors**: The container waits 30 seconds and retries database operations up to 10 times. Check logs for detailed error messages.
5. **Container keeps restarting**: This usually indicates database connection issues. Verify RDS is ready and credentials are correct in Secrets Manager.

### Common Issues

- **"You need to initialize the database"**: This is handled automatically with retry logic. The container should eventually succeed.
- **Database connection timeout**: RDS t3.micro instances can take 5-10 minutes to become available after deployment.
- **Health check failures**: Airflow needs time to start. Health checks may fail for the first 5-10 minutes.

## Useful Commands

- `cdk synth` - Synthesize CloudFormation template
- `cdk diff` - Compare deployed stack with current state
- `cdk deploy --hotswap` - Fast deployment for development
- `aws ecs describe-services --cluster airflow-cluster` - Check ECS service status
