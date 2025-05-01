# Monitoring and Troubleshooting GitLab on AWS

This guide provides detailed information on monitoring and troubleshooting the GitLab deployment on AWS.

## Monitoring Resources

### ECS Service Monitoring

1. **CloudWatch Container Insights**:
   - Navigate to CloudWatch in the AWS Console
   - Select "Container Insights" from the left menu
   - Monitor CPU, memory, and network metrics for the GitLab ECS service

2. **ECS Service Events**:
   - Navigate to ECS in the AWS Console
   - Select the GitLab ECS cluster
   - View the "Events" tab to see service deployment events

3. **Task Status**:
   - In the ECS console, view the tasks in the GitLab service
   - Check if tasks are RUNNING, PENDING, or STOPPED
   - For stopped tasks, examine the "Stopped reason" field

### EFS Monitoring

1. **CloudWatch Metrics**:
   - Navigate to CloudWatch in the AWS Console
   - Select "Metrics" and find EFS metrics
   - Monitor throughput, burst credits, and connection count

2. **EFS Status**:
   - Navigate to EFS in the AWS Console
   - Check the status of the file system and mount targets
   - Verify mount targets are active in all required availability zones

### Application Load Balancer

1. **Target Health**:
   - Navigate to EC2 > Load Balancers
   - Select the GitLab ALB
   - View the "Target Groups" tab and check the health of targets

2. **ALB Logs**:
   - Enable ALB logging to S3 if needed
   - Analyze access patterns and errors

## Troubleshooting Common Issues

### EFS Mounting Problems

If tasks fail with "ResourceInitializationError" related to EFS mounting:

1. **Verify Security Groups**:
   ```bash
   # Check EFS security group
   aws ec2 describe-security-groups --group-ids sg-xxxxxxxxxx
   
   # Verify EFS mount targets
   aws efs describe-mount-targets --file-system-id fs-xxxxxxxxxx
   ```

2. **Check IAM Permissions**:
   ```bash
   # Get task role
   aws iam get-role --role-name GitLabTaskExecutionRole-xxxx
   
   # Check policy attachments
   aws iam list-role-policies --role-name GitLabTaskExecutionRole-xxxx
   ```

3. **Test EFS Access**:
   - Launch a test EC2 instance in the same subnet
   - Mount the EFS file system to verify accessibility

   ```bash
   # On the EC2 instance
   sudo mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport fs-xxxxxxxxxx.efs.region.amazonaws.com:/ /mnt/efs
   ```

### Container Startup Issues

1. **Check Container Logs**:
   ```bash
   # Get the task ID
   aws ecs list-tasks --cluster GitLabCluster --service-name GitLabService
   
   # Get the logs
   aws logs get-log-events --log-group /ecs/gitlab --log-stream ecs/GitLabContainer/task-id
   ```

2. **Check Docker Image**:
   ```bash
   # Verify the image can be pulled
   docker pull gitlab/gitlab-ce:latest
   ```

3. **Inspect Task Definition**:
   ```bash
   # Get task definition details
   aws ecs describe-task-definition --task-definition GitLabTaskDef
   ```

## Recovery Steps

### Recovering from EFS Mount Failures

1. **Recreate Mount Targets**:
   ```bash
   # Delete problematic mount targets
   aws efs delete-mount-target --mount-target-id fsmt-xxxx
   
   # Create new mount targets
   aws efs create-mount-target --file-system-id fs-xxxx --subnet-id subnet-xxxx --security-groups sg-xxxx
   ```

2. **Restart ECS Tasks**:
   ```bash
   # Force new deployment
   aws ecs update-service --cluster GitLabCluster --service GitLabService --force-new-deployment
   ```

### Rebuilding the GitLab Container

If GitLab becomes corrupted or unresponsive:

1. **Create an EFS Backup**:
   - Use AWS Backup to create a snapshot of the EFS file system
   - Or create a manual backup using an EC2 instance

2. **Force New Deployment**:
   ```bash
   aws ecs update-service --cluster GitLabCluster --service GitLabService --force-new-deployment
   ```

3. **Monitor Task Startup**:
   - Wait for the new task to start and reach a healthy state
   - Check the CloudWatch logs for any errors during startup

## Performance Optimization

### EFS Performance

1. **Use EFS Provisioned Throughput**:
   - Consider using Provisioned Throughput instead of Bursting Throughput for consistent performance
   - Adjust the CDK code to add provisioned throughput

2. **Monitor Throughput and Burst Credits**:
   - Create CloudWatch alarms for low burst credits
   - Set up notifications when throughput approaches limits

### ECS Task Performance

1. **Adjust CPU and Memory**:
   - Increase task CPU and memory allocations for better performance
   - Monitor utilization to find the optimal settings

2. **Container Placement**:
   - Ensure tasks are distributed across availability zones
   - Use FARGATE_SPOT for non-production workloads to reduce costs 