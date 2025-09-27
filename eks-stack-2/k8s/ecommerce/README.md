# Ecommerce Application Deployment

This directory contains Kubernetes deployment files for a full-stack ecommerce application consisting of:

1. **Frontend**: React.js application (Port 3000)
2. **Backend**: Spring Boot REST API (Port 8080)
3. **Database**: MySQL 8.0 (Port 3306)

## Architecture

```
Internet → ALB Ingress → Frontend (React) → Backend (Spring Boot) → MySQL Database
```

## Components

### MySQL Database (`mysql-deployment.yaml`)
- MySQL 8.0 with persistent storage (10GB PVC)
- Database: `ecommerce`
- User: `ecommerce_user` / Password: `ecommerce_password`
- Root password: `rootpassword`
- Health checks and resource limits configured

### Backend API (`backend-deployment.yaml`)
- Spring Boot application with 2 replicas
- Connects to MySQL using JDBC
- Health checks via Spring Actuator endpoints
- Init container waits for MySQL to be ready
- CORS configured for frontend access

### Frontend (`frontend-deployment.yaml`)
- React application with 2 replicas
- Nginx configuration for serving static files and proxying API calls
- Environment variables for backend connectivity

### Ingress (`ingress.yaml`)
- AWS ALB Ingress Controller configuration
- Routes `/` to frontend, `/api` to backend
- NodePort services for direct access during development

## Deployment

### Quick Deploy
```bash
# Make sure you're connected to your EKS cluster
kubectl config current-context

# Deploy all components
cd k8s/ecommerce
./deploy.sh
```

### Manual Deploy
```bash
# 1. Deploy MySQL first
kubectl apply -f mysql-deployment.yaml

# 2. Wait for MySQL, then deploy backend
kubectl apply -f backend-deployment.yaml

# 3. Deploy frontend
kubectl apply -f frontend-deployment.yaml

# 4. Deploy ingress
kubectl apply -f ingress.yaml
```

## Access Methods

### 1. Port Forwarding (Development)
```bash
# Frontend
kubectl port-forward service/ecommerce-frontend-nodeport 3000:3000
# Access: http://localhost:3000

# Backend API
kubectl port-forward service/ecommerce-backend-nodeport 8080:8080
# Access: http://localhost:8080

# MySQL (for debugging)
kubectl port-forward service/mysql-service 3306:3306
```

### 2. LoadBalancer (Production)
```bash
# Get ALB URL
kubectl get ingress ecommerce-ingress
# Access via the ALB DNS name
```

## Monitoring

```bash
# Check deployment status
kubectl get deployments
kubectl get services
kubectl get pods
kubectl get ingress

# Check logs
kubectl logs -l app=ecommerce-backend
kubectl logs -l app=ecommerce-frontend
kubectl logs -l app=mysql

# Check pod details
kubectl describe pod <pod-name>
```

## Configuration

### Environment Variables

**Backend**:
- `SPRING_DATASOURCE_URL`: MySQL connection string
- `SPRING_PROFILES_ACTIVE`: Set to "k8s"
- `CORS_ALLOWED_ORIGINS`: Frontend URLs

**Frontend**:
- `REACT_APP_API_BASE_URL`: Backend service URL
- `REACT_APP_BACKEND_URL`: Backend service URL

### Docker Images

The deployment assumes these Docker images exist:
- `yennanliu/shopping-cart-backend:latest`
- `yennanliu/shopping-cart-frontend:latest`

Make sure to build and push these images to a container registry accessible by your EKS cluster.

## Cleanup

```bash
# Delete all ecommerce resources
kubectl delete -f .

# Or delete specific components
kubectl delete -f ingress.yaml
kubectl delete -f frontend-deployment.yaml
kubectl delete -f backend-deployment.yaml
kubectl delete -f mysql-deployment.yaml
```

## Troubleshooting

1. **Backend can't connect to MySQL**:
   - Check if MySQL pod is ready: `kubectl get pods -l app=mysql`
   - Check MySQL logs: `kubectl logs -l app=mysql`
   - Verify service DNS: `kubectl get svc mysql-service`

2. **Frontend can't reach Backend**:
   - Check backend service: `kubectl get svc ecommerce-backend-service`
   - Check environment variables in frontend pod
   - Verify CORS configuration in backend

3. **External access issues**:
   - Check if AWS Load Balancer Controller is installed
   - Verify ingress annotations
   - Check security groups allow traffic on ports 80/443