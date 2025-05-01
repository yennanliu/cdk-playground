# GitLab AWS Infrastructure Architecture

This document outlines the architecture of the GitLab deployment on AWS using CDK.

## Infrastructure Components

### VPC and Networking
- VPC with public and private subnets across 2 availability zones
- NAT Gateway for outbound internet access from private subnets
- Internet Gateway for inbound traffic to public subnets

### Compute (ECS Fargate)
- ECS Cluster for managing containerized applications
- Fargate Task Definition for GitLab with 2 vCPU and 4GB memory
- Fargate Service running in private subnets

### Storage (EFS)
- Encrypted EFS file system for GitLab data persistence
- Mount points in each availability zone
- Data stored in `/var/opt/gitlab` directory inside the container

### Load Balancing
- Application Load Balancer (ALB) deployed in public subnets
- HTTP listener on port 80
- Target group routing traffic to GitLab container

### Security
- Security groups controlling access:
  - EFS Security Group: Allows NFS traffic only from GitLab service
  - GitLab Service Security Group: Allows inbound HTTP (80), HTTPS (443), and SSH (22)
  - ALB Security Group: Allows public inbound HTTP traffic

## Architecture Diagram

```
                                    ┌───────────────────────────────────────────────────────────┐
                                    │                       AWS Cloud                           │
                                    │                                                           │
                                    │  ┌─────────────────────────────────────────────────────┐ │
                                    │  │                         VPC                         │ │
┌─────────┐                         │  │                                                     │ │
│         │                         │  │  ┌─────────────┐         ┌──────────────────────┐  │ │
│ Users   │─────────────────────────┼──┼─▶│    ALB      │────────▶│   ECS Fargate        │  │ │
│         │         HTTP/HTTPS      │  │  │ (Public)    │         │   (Private Subnet)   │  │ │
└─────────┘                         │  │  └─────────────┘         │                      │  │ │
                                    │  │                          │   ┌──────────────┐   │  │ │
                                    │  │                          │   │ GitLab       │   │  │ │
                                    │  │                          │   │ Container    │   │  │ │
                                    │  │                          │   └──────┬───────┘   │  │ │
                                    │  │                          └──────────┼───────────┘  │ │
                                    │  │                                     │              │ │
                                    │  │                                     ▼              │ │
                                    │  │                          ┌──────────────────────┐  │ │
                                    │  │                          │     EFS Storage      │  │ │
                                    │  │                          │  (Persistent Data)   │  │ │
                                    │  │                          └──────────────────────┘  │ │
                                    │  │                                                     │ │
                                    │  └─────────────────────────────────────────────────────┘ │
                                    │                                                           │
                                    └───────────────────────────────────────────────────────────┘
```

## Deployment Flow

1. CDK creates all AWS resources required for the infrastructure
2. EFS file system is created for persistent storage
3. Fargate task definition is defined with GitLab container image
4. ALB is configured to direct traffic to GitLab service
5. Fargate service is started, pulling the GitLab container and mounting EFS
6. GitLab becomes accessible via the ALB's DNS name

## Scaling Considerations

This architecture provides a foundation that can be enhanced with:

- Auto Scaling for GitLab service based on CPU/memory utilization
- Certificate manager for HTTPS
- RDS for database (instead of using the built-in PostgreSQL)
- Separate Redis instance for improved performance
- CI/CD Runners in a separate ECS service or on EC2

## Security Considerations

- All data at rest is encrypted with EFS encryption
- Network traffic is controlled via security groups
- Private subnets for GitLab service protect direct access
- Consider adding AWS WAF to the ALB for additional protection
- Add HTTPS with AWS Certificate Manager 