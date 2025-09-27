# ECS Frontend-Backend Deployment Guide

## Architecture Overview

This CDK stack deploys a containerized frontend-backend application on AWS using ECS Fargate with the following architecture:

```
Internet
    |
    v
[Application Load Balancer]
    |
    ├─ /api/* ──→ [Backend Service] ──→ [RDS MySQL]
    |                    │
    └─ /*     ──→ [Frontend Service]   │
                         │              │
                    [ECS Fargate]  [ECS Fargate]
                         │              │
                    [ECR Repository] [ECR Repository]
```

## AWS Services Used

- **VPC**: Virtual Private Cloud with 2 public subnets across AZs
- **ECS Fargate**: Serverless container platform running BE and FE services
- **Application Load Balancer**: Path-based routing with public access
- **ECR**: Elastic Container Registry for Docker images
- **RDS MySQL**: Managed database for backend storage
- **CloudWatch Logs**: Container logging
- **Secrets Manager**: Database credentials management

## Deployed Resources

### Networking
- VPC with 2 public subnets (no NAT gateways)
- Security groups with public access as requested
- ALB with HTTP listener on port 80

### Services
- **Backend**: Spring Boot app on port 8080 (`/api/*` path)
- **Frontend**: React app on port 80 (`/*` path)
- **Database**: RDS MySQL t3.micro instance

### Path-Based Routing
- `http://ALB-DNS/api/*` → Backend Service
- `http://ALB-DNS/*` → Frontend Service

## Deployment Steps

### 1. Prerequisites
```bash
npm install -g aws-cdk
aws configure  # Set up AWS credentials
```

### 2. Deploy Infrastructure
```bash
# Install dependencies
npm install

# Build the project
npm run build

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy the stack
cdk deploy
```

### 3. Build and Push Docker Images

After deployment, get ECR repository URIs from stack outputs:

```bash
# Get ECR login command
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <BACKEND_ECR_URI>

# Backend - Build and push
git clone https://github.com/yennanliu/SpringPlayground.git
cd SpringPlayground/ShoppingCart/Backend
docker build -t shopping-cart-backend .
docker tag shopping-cart-backend:latest <BACKEND_ECR_URI>:latest
docker push <BACKEND_ECR_URI>:latest

# Frontend - Build and push
cd ../Frondend/ecommerce-ui
docker build -t shopping-cart-frontend .
docker tag shopping-cart-frontend:latest <FRONTEND_ECR_URI>:latest
docker push <FRONTEND_ECR_URI>:latest
```

### 4. Restart ECS Services
```bash
# Force new deployment to pull latest images
aws ecs update-service --cluster shopping-cart-cluster --service <BACKEND_SERVICE_NAME> --force-new-deployment
aws ecs update-service --cluster shopping-cart-cluster --service <FRONTEND_SERVICE_NAME> --force-new-deployment
```

## Configuration

### Backend Configuration
The backend container receives these environment variables:
- `SPRING_PROFILES_ACTIVE=prod`
- `SERVER_PORT=8080`
- Database connection details via Secrets Manager

### Database Setup
- Engine: MySQL 8.0.35
- Instance: t3.micro
- Database name: `shoppingcart`
- Credentials: Auto-generated in Secrets Manager

### Health Checks
- **Backend**: `/actuator/health`
- **Frontend**: `/`

## Accessing the Application

After deployment:
1. Get ALB DNS name from stack outputs
2. Access frontend: `http://<ALB_DNS_NAME>`
3. Access backend API: `http://<ALB_DNS_NAME>/api/*`

## Monitoring

- **CloudWatch Logs**: `/ecs/shopping-cart-backend` and `/ecs/shopping-cart-frontend`
- **ALB Target Groups**: Health check status in EC2 console
- **ECS Services**: Service status and task health

## Cleanup

```bash
cdk destroy
```

## Security Notes

As requested, this deployment uses public subnets and allows public access. In production, consider:
- Using private subnets with NAT gateways
- Adding HTTPS/TLS termination
- Implementing authentication/authorization
- Restricting security group access

## Troubleshooting

1. **Service failing to start**: Check CloudWatch logs for container errors
2. **Health check failures**: Verify application exposes health endpoints
3. **Database connectivity**: Ensure security groups allow port 3306
4. **Image pull errors**: Verify ECR permissions and image tags