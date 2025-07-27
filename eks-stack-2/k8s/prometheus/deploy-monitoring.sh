#!/bin/bash

# Deploy Enhanced Prometheus and Grafana Monitoring Stack for EKS
echo "🚀 Deploying Enhanced Monitoring Stack..."

# Apply the monitoring configuration
kubectl apply -f ~/cdk-playground/eks-stack-2/k8s/prometheus/prometheus-grafana-deployment.yaml

# Wait for deployments to be ready
echo "⏳ Waiting for deployments to be ready..."
kubectl wait --namespace=monitoring --for=condition=available deployment/prometheus --timeout=300s
kubectl wait --namespace=monitoring --for=condition=available deployment/grafana --timeout=300s
kubectl wait --namespace=monitoring --for=condition=available deployment/kube-state-metrics --timeout=300s

# Check if all pods are running
echo "📋 Checking pod status..."
kubectl get pods -n monitoring

# Get Grafana service details
echo "📊 Getting Grafana service details..."
kubectl get svc -n monitoring grafana-service

# Get external IP for Grafana (if LoadBalancer type)
echo "🌐 Getting Grafana external access..."
echo "Grafana External IP (may take a few minutes to provision):"
kubectl get svc -n monitoring grafana-service -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
echo ""

# Port forward instructions
echo "🔗 To access Grafana locally, run:"
echo "kubectl port-forward -n monitoring svc/grafana-service 3000:3000"
echo ""
echo "Then access Grafana at: http://localhost:3000"
echo "Username: admin"
echo "Password: admin"
echo ""

echo "✅ Monitoring stack deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Access Grafana UI"
echo "2. Verify Prometheus data source is configured"
echo "3. Import EKS dashboards (dashboard IDs provided separately)"
echo "4. Configure alerting rules if needed" 