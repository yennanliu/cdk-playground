#!/bin/bash

# Ecommerce Application Deployment Script for Kubernetes

echo "Deploying Ecommerce Application to Kubernetes..."

# Deploy MySQL first
echo "1. Deploying MySQL database..."
kubectl apply -f mysql-deployment.yaml

# Wait for MySQL to be ready
echo "Waiting for MySQL to be ready..."
kubectl wait --for=condition=ready pod -l app=mysql --timeout=300s

# Deploy Backend
echo "2. Deploying Backend (Spring Boot)..."
kubectl apply -f backend-deployment.yaml

# Wait for Backend to be ready
echo "Waiting for Backend to be ready..."
kubectl wait --for=condition=ready pod -l app=ecommerce-backend --timeout=300s

# Deploy Frontend
echo "3. Deploying Frontend (React)..."
kubectl apply -f frontend-deployment.yaml

# Wait for Frontend to be ready
echo "Waiting for Frontend to be ready..."
kubectl wait --for=condition=ready pod -l app=ecommerce-frontend --timeout=300s

# Deploy Ingress
echo "4. Deploying Ingress..."
kubectl apply -f ingress.yaml

echo "Deployment completed!"

# Show deployment status
echo "Checking deployment status..."
kubectl get deployments
kubectl get services
kubectl get pods
kubectl get ingress

echo ""
echo "Access the application:"
echo "Frontend (NodePort): kubectl port-forward service/ecommerce-frontend-nodeport 3000:3000"
echo "Backend (NodePort): kubectl port-forward service/ecommerce-backend-nodeport 8080:8080"
echo "MySQL: kubectl port-forward service/mysql-service 3306:3306"
echo ""
echo "Or access via LoadBalancer URL once available:"
echo "kubectl get ingress ecommerce-ingress"