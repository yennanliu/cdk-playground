# WordPress on ECS with CDK

A complete AWS CDK TypeScript stack that deploys WordPress on Amazon ECS with all necessary supporting infrastructure.

## Architecture

This stack creates a highly available, scalable WordPress deployment with the following components:

### Infrastructure Components

- **VPC**: Custom VPC with public and private subnets across 2 Availability Zones
- **Application Load Balancer (ALB)**: Internet-facing load balancer for high availability
- **ECS Fargate Cluster**: Containerized WordPress application running on Fargate
- **RDS MySQL**: Managed MySQL database for WordPress data
- **EFS**: Elastic File System for persistent WordPress files and uploads
- **Auto Scaling**: CPU and memory-based auto scaling for ECS tasks
- **CloudWatch Logs**: Centralized logging for application monitoring
- **AWS Secrets Manager**: Secure storage for database credentials

### Security Features

- **Security Groups**: Proper network segmentation with least-privilege access
- **Private Subnets**: Database and ECS tasks run in private subnets
- **Encrypted Storage**: EFS uses transit encryption
- **Secrets Management**: Database credentials stored securely in Secrets Manager

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js (version 18 or later)
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Deployment

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Bootstrap CDK (if first time using CDK in this region):**
   ```bash
   cdk bootstrap
   ```

4. **Deploy the stack:**
   ```bash
   cdk deploy
   ```

   The deployment will take approximately 10-15 minutes due to RDS and ALB provisioning.

5. **Access WordPress:**
   After deployment, note the `LoadBalancerDNS` output. This is your WordPress URL.

## Stack Outputs

After deployment, you'll see these important outputs:

- **LoadBalancerDNS**: The URL to access your WordPress site
- **DatabaseEndpoint**: RDS database endpoint (for reference)
- **EFSFileSystemId**: EFS file system ID (for reference)

## Configuration

### Scaling Configuration

The stack includes auto-scaling based on:
- **CPU Utilization**: Scales when CPU > 70%
- **Memory Utilization**: Scales when memory > 80%
- **Capacity**: Min 1 task, Max 10 tasks

### Resource Specifications

- **ECS Tasks**: 1 vCPU, 2GB RAM per task
- **RDS Instance**: t3.micro MySQL 8.0
- **Initial Task Count**: 2 tasks for high availability

## WordPress Setup

1. Navigate to the Load Balancer DNS URL
2. Complete the WordPress installation wizard
3. Create your admin account
4. Your WordPress site is ready!

## Monitoring and Logs

- **CloudWatch Logs**: Application logs are available in `/ecs/wordpress` log group
- **ECS Console**: Monitor task health and scaling events
- **RDS Console**: Monitor database performance and connections

## Customization

### Environment Variables

You can modify WordPress configuration by updating the container environment variables in the stack:

```typescript
environment: {
  WORDPRESS_DB_HOST: database.instanceEndpoint.hostname,
  WORDPRESS_DB_NAME: 'wordpress',
  // Add custom WordPress environment variables here
},
```

### Instance Sizes

To change resource allocation, modify these values in the stack:

```typescript
// Task Definition
const taskDefinition = new ecs.FargateTaskDefinition(this, 'WordPressTaskDef', {
  memoryLimitMiB: 2048,  // Adjust memory
  cpu: 1024,            // Adjust CPU
});

// RDS Instance
instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
```

## Clean Up

To avoid ongoing charges, destroy the stack when no longer needed:

```bash
cdk destroy
```

**Warning**: This will delete all data including the database and uploaded files. Make sure to backup any important data before destroying the stack.

## Security Considerations

- The ALB accepts HTTP traffic on port 80. For production, consider adding HTTPS/SSL certificates
- Database credentials are auto-generated and stored in AWS Secrets Manager
- All components use security groups with least-privilege access patterns
- Database and ECS tasks run in private subnets without direct internet access

## Troubleshooting

### Common Issues

1. **Tasks failing to start**: Check CloudWatch logs in `/ecs/wordpress` log group
2. **Database connection issues**: Verify security group rules and RDS availability
3. **File upload issues**: Ensure EFS is properly mounted and accessible

### Useful Commands

- View logs: `aws logs tail /ecs/wordpress --follow`
- Check ECS service status: AWS Console → ECS → Clusters → WordPressCluster
- Monitor RDS: AWS Console → RDS → Databases → WordPressDB

## Cost Optimization

For development/testing environments, consider:
- Using t3.nano RDS instances
- Reducing ECS task memory/CPU
- Setting desired count to 1 instead of 2
- Disabling RDS backups for non-production environments

## Contributing

Feel free to submit issues and enhancement requests!
