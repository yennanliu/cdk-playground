# GitBucket on AWS ECS with Persistent Storage and Database

This CDK stack deploys GitBucket on AWS ECS Fargate with the following enhancements:

## Features

1. **Persistent File Storage**: Uses Amazon EFS for persistent data storage
2. **External Database**: Uses Amazon RDS PostgreSQL instead of embedded H2 database
3. **Git Push Timeout Fix**: Configured load balancer settings to handle large git operations

## Architecture

- **VPC**: Multi-AZ VPC with public, private, and isolated subnets
- **ECS Fargate**: Runs GitBucket container with 2GB memory and 1 vCPU
- **Amazon EFS**: Provides persistent storage for GitBucket data
- **Amazon RDS**: PostgreSQL database for GitBucket metadata
- **Application Load Balancer**: Routes traffic with optimized timeout settings
- **AWS Secrets Manager**: Stores database credentials securely

## Git Push Timeout Issue - Root Cause and Solution

### Root Cause
The "unexpected disconnect while reading sideband packet" error during `git push` operations is typically caused by:

1. **Load Balancer Idle Timeout**: Default ALB idle timeout (60 seconds) is too short for large git push operations
2. **Target Group Deregistration**: Quick container restarts during deployments can interrupt ongoing git operations
3. **Insufficient Resources**: Limited CPU/memory can cause slow processing of large repositories

### Solution Implemented

1. **Increased Load Balancer Idle Timeout**: Set to 300 seconds (5 minutes)
   ```typescript
   fargateService.loadBalancer.setAttribute(
     "idle_timeout.timeout_seconds",
     "300"
   );
   ```

2. **Extended Target Group Deregistration Delay**: Allows ongoing operations to complete
   ```typescript
   fargateService.targetGroup.setAttribute(
     "deregistration_delay.timeout_seconds",
     "300"
   );
   ```

3. **Increased Container Resources**: 2GB memory and 1 vCPU for better performance
   ```typescript
   const taskDefinition = new ecs.FargateTaskDefinition(this, "GitBucketTaskDef", {
     memoryLimitMiB: 2048,
     cpu: 1024,
   });
   ```

4. **Optimized Health Checks**: Configured for better stability during operations

## Deployment

### Prerequisites
- AWS CLI configured
- Node.js and npm installed
- AWS CDK installed (`npm install -g aws-cdk`)

### Deploy
```bash
npm install
cdk bootstrap  # if not already done
cdk deploy
```

### Access GitBucket
After deployment, access GitBucket using the load balancer URL from the stack outputs.

**Default Credentials**: 
- Username: `root`
- Password: `root`

## Database Configuration

The stack automatically:
1. Creates a PostgreSQL RDS instance
2. Generates secure database credentials in AWS Secrets Manager
3. Creates a `database.conf` file in EFS with the correct database connection settings
4. Configures GitBucket to use PostgreSQL instead of H2

## Persistent Storage

All GitBucket data is stored in Amazon EFS:
- Repository data
- User configurations
- Plugin data
- Database configuration

Data persists across container restarts and deployments.

## Security

- Database runs in isolated subnets with no internet access
- EFS and RDS use security groups with minimal required access
- Database credentials stored securely in AWS Secrets Manager
- All data encrypted at rest and in transit

## Monitoring

- CloudWatch logs for container output
- EFS and RDS CloudWatch metrics
- Load balancer access logs (can be enabled)

## Cost Optimization

- Uses Fargate Spot pricing (can be enabled)
- EFS Intelligent Tiering for cost optimization
- RDS t3.micro instance for development workloads

## Production Considerations

For production use, consider:
1. Enable RDS deletion protection
2. Increase RDS instance size
3. Enable RDS Multi-AZ deployment
4. Configure backup retention policies
5. Set up monitoring and alerting
6. Use HTTPS with SSL certificates
7. Implement proper access controls

## Troubleshooting

### Git Push Still Fails
If you still experience git push timeouts:
1. Check CloudWatch logs for container errors
2. Verify EFS mount is working
3. Ensure database connectivity
4. Consider increasing timeout values further

### Database Connection Issues
1. Check security group rules
2. Verify database credentials in Secrets Manager
3. Check RDS instance status
4. Review CloudWatch logs

### EFS Mount Issues
1. Verify EFS security group allows NFS traffic
2. Check EFS access point configuration
3. Review IAM permissions for EFS access
