# ECS Frontend-Backend Application

AWS ECS deployment for a containerized shopping cart application with frontend (React) and backend (Spring Boot) services.

## System Design

### Architecture Diagram
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

### Components
- **Frontend**: React eCommerce UI serving on port 80
- **Backend**: Spring Boot REST API serving on port 8080
- **Database**: RDS MySQL for data persistence
- **Load Balancer**: ALB with path-based routing
- **Container Registry**: ECR for Docker images

### Routing Strategy
- `http://ALB-DNS/` → Frontend Service (React app)
- `http://ALB-DNS/api/*` → Backend Service (Spring Boot API)

## Tech Stack

### Infrastructure
- **AWS CDK**: TypeScript for Infrastructure as Code
- **ECS Fargate**: Serverless container platform
- **Application Load Balancer**: Layer 7 load balancing with path-based routing
- **RDS MySQL**: Managed relational database
- **ECR**: Elastic Container Registry
- **VPC**: Public subnets with internet gateway (no NAT)
- **CloudWatch Logs**: Container logging and monitoring

### Applications
- **Frontend**: React.js eCommerce UI
- **Backend**: Spring Boot with MySQL integration
- **Source**: [ShoppingCart Repository](https://github.com/yennanliu/SpringPlayground/tree/main/ShoppingCart)

## Commands

### Build & Development
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to JavaScript
npm run watch        # Watch for changes and compile
npm run test         # Run Jest unit tests
```

### CDK Deployment
```bash
cdk bootstrap        # Bootstrap CDK (first time only)
cdk synth            # Generate CloudFormation template
cdk diff             # Compare with deployed stack
cdk deploy           # Deploy infrastructure to AWS
cdk destroy          # Remove all resources
```

### Docker Image Build & Push
```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ECR_URI>

# Backend
git clone https://github.com/yennanliu/SpringPlayground.git
cd SpringPlayground/ShoppingCart/Backend
docker build -t shopping-cart-backend .
docker tag shopping-cart-backend:latest <BACKEND_ECR_URI>:latest
docker push <BACKEND_ECR_URI>:latest

# Frontend
cd ../Frondend/ecommerce-ui
docker build -t shopping-cart-frontend .
docker tag shopping-cart-frontend:latest <FRONTEND_ECR_URI>:latest
docker push <FRONTEND_ECR_URI>:latest
```

### ECS Service Management
```bash
# Force new deployment after pushing images
aws ecs update-service --cluster shopping-cart-cluster --service <SERVICE_NAME> --force-new-deployment

# View service status
aws ecs describe-services --cluster shopping-cart-cluster --services <SERVICE_NAME>

# View logs
aws logs tail /ecs/shopping-cart-backend --follow
aws logs tail /ecs/shopping-cart-frontend --follow
```

## Quick Start

1. **Deploy Infrastructure**:
   ```bash
   npm install && npm run build
   cdk deploy
   ```

2. **Build & Push Images**:
   - Get ECR URIs from stack outputs
   - Build and push both frontend and backend images

3. **Access Application**:
   - Frontend: `http://<ALB_DNS_NAME>`
   - Backend API: `http://<ALB_DNS_NAME>/api/*`

## Configuration

### Stack Outputs
- `ALBDnsName`: Load balancer DNS for application access
- `BackendRepositoryUri`: ECR repository for backend images
- `FrontendRepositoryUri`: ECR repository for frontend images
- `DatabaseEndpoint`: RDS MySQL endpoint
- `DatabaseSecretArn`: Database credentials in Secrets Manager

### Environment Variables
- **Backend**: `SPRING_PROFILES_ACTIVE=prod`, `SERVER_PORT=8080`
- **Database**: Connection details injected via Secrets Manager

For detailed deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).
