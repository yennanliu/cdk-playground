# GitLab Deployment on AWS using CDK

This is a project for deploying GitLab on AWS using AWS CDK with TypeScript.

## Architecture

The infrastructure includes:

* VPC with public and private subnets across 2 availability zones
* ECS Fargate Cluster for containerized GitLab deployment
* EFS for persistent storage of GitLab data
* Application Load Balancer for public access
* Security Groups to control network access

## Prerequisites

* AWS CLI configured with appropriate credentials
* Node.js 14.x or later
* AWS CDK installed (`npm install -g aws-cdk`)

## Deployment

1. Install dependencies:
```
npm install
```

2. Synthesize CloudFormation template:
```
npx cdk synth
```

3. Deploy the stack:
```
npx cdk deploy
```

After deployment, the GitLab URL will be displayed in the outputs section.

## Cleanup

To destroy the resources:
```
npx cdk destroy
```

## Configuration

If you need to customize the GitLab deployment, edit the stack in `lib/gitlab-deployment-v2-stack.ts`.

## Troubleshooting

### EFS Mounting Issues

If you encounter EFS mounting errors in your container logs (check CloudWatch Logs), such as:

```
ResourceInitializationError: failed to invoke EFS utils commands to set up EFS volumes: 
mount.nfs4: mount system call failed
```

This is usually due to one of the following issues:

1. **Security Group Configuration**: Ensure the EFS security group allows inbound traffic on port 2049 from the task security group.

2. **IAM Permissions**: The task execution role must have permissions to access EFS:
   - `elasticfilesystem:ClientMount`
   - `elasticfilesystem:ClientWrite`
   - `elasticfilesystem:DescribeMountTargets`

3. **VPC Subnet Configuration**: Ensure EFS mount targets and ECS tasks are in the same VPC and compatible subnets.

4. **EFS Access Point**: Using an EFS access point can help with proper permissions and mounting.

### Permission Issues

If GitLab container starts but fails with permission errors like:

```
Errno::EACCES: Permission denied @ rb_sysopen - /var/opt/gitlab/.gitconfig
```

This indicates a permission issue with the EFS-mounted volume. The solution involves:

1. **Initialization Container**: The stack now includes an initialization container that properly prepares directory structure and permissions.

2. **Directory Ownership**: GitLab processes run as user with UID/GID 998, so mounted directories need these permissions.

3. **Access Point Configuration**: The EFS access point's POSIX user settings should allow proper permissions management.

4. **Manual Intervention**: If issues persist, you may need to manually fix permissions using the following steps:
   - Launch a temporary EC2 instance in the same VPC
   - Mount the EFS file system
   - Run `sudo chown -R 998:998 /mnt/efs/*` 
   - Run `sudo chmod -R 775 /mnt/efs/`

### Service Discovery Issues

If GitLab container starts but cannot be accessed:

1. Check the ALB health checks in the AWS Console
2. Verify security group rules allow traffic from the ALB to the container
3. Check if the container is exposing the correct port (80)

### Container Startup Issues

If GitLab container fails to start:

1. Check the container logs in CloudWatch Logs
2. Ensure the container has enough memory and CPU resources
3. Verify the task execution role has permissions to pull the container image
