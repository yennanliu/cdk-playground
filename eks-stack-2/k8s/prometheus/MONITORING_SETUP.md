# EKS Monitoring Setup Guide

## Overview
This guide covers the enhanced Prometheus and Grafana monitoring setup for your EKS cluster, including comprehensive metrics collection and dashboard configuration.

## What's Included

### Components Deployed
- **Prometheus** - Metrics collection and storage
- **Node Exporter** - Node-level metrics (CPU, memory, disk, network)
- **kube-state-metrics** - Kubernetes object state metrics
- **Grafana** - Visualization and dashboards
- **RBAC** - Proper service accounts and permissions

### Metrics Collected
- **Node Metrics**: CPU, memory, disk usage, network I/O
- **Pod Metrics**: Container resource usage, restart counts
- **Kubernetes API Metrics**: API server performance
- **cAdvisor Metrics**: Container-level resource usage
- **Cluster State**: Deployments, services, pods status

## Deployment

### 1. Deploy the Stack
```bash
# Make the script executable
chmod +x k8s/deploy-monitoring.sh

# Deploy the monitoring stack
./k8s/deploy-monitoring.sh
```

### 2. Update CDK Stack (Optional but Recommended)
Deploy the updated CDK stack with Container Insights:
```bash
cdk deploy
```

## Accessing Grafana

### Option 1: LoadBalancer (External Access)
```bash
# Get the external URL
kubectl get svc -n monitoring grafana-service
# Wait for EXTERNAL-IP to be assigned
```

### Option 2: Port Forwarding (Local Access)
```bash
kubectl port-forward -n monitoring svc/grafana-service 3000:3000
```
Then access: http://localhost:3000

**Default Credentials:**
- Username: `admin`
- Password: `admin`

## Grafana Dashboard Setup

### 1. Verify Data Source
- Prometheus should be auto-configured at `http://prometheus-service:9090`
- Go to **Configuration > Data Sources** to verify

### 2. Import EKS Dashboards

#### Essential Dashboards for EKS:

**Kubernetes Cluster Overview**
- Dashboard ID: `7249`
- URL: https://grafana.com/grafana/dashboards/7249
- Shows: Cluster-wide resource usage, node status

**Kubernetes Pods**
- Dashboard ID: `6417`
- URL: https://grafana.com/grafana/dashboards/6417
- Shows: Pod resource usage, container metrics

**Node Exporter Full**
- Dashboard ID: `1860`
- URL: https://grafana.com/grafana/dashboards/1860
- Shows: Detailed node metrics

**Kubernetes Deployment Statefulset Daemonset metrics**
- Dashboard ID: `8588`
- URL: https://grafana.com/grafana/dashboards/8588
- Shows: Workload-specific metrics

**AWS EKS Cluster**
- Dashboard ID: `14623`
- URL: https://grafana.com/grafana/dashboards/14623
- Shows: EKS-specific metrics and health

#### How to Import:
1. In Grafana, click **+** → **Import**
2. Enter the Dashboard ID (e.g., `7249`)
3. Click **Load**
4. Select **prometheus** as the data source
5. Click **Import**

### 3. Custom Metrics and Queries

#### Essential PromQL Queries for EKS:

**Node CPU Usage:**
```promql
100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
```

**Node Memory Usage:**
```promql
100 * (1 - ((node_memory_MemAvailable_bytes) / (node_memory_MemTotal_bytes)))
```

**Pod CPU Usage:**
```promql
sum(rate(container_cpu_usage_seconds_total{container!="POD",container!=""}[5m])) by (pod)
```

**Pod Memory Usage:**
```promql
sum(container_memory_working_set_bytes{container!="POD",container!=""}) by (pod)
```

**Pod Restart Count:**
```promql
increase(kube_pod_container_status_restarts_total[1h])
```

## Monitoring Checklist

### ✅ After Deployment, Verify:

1. **All pods are running:**
   ```bash
   kubectl get pods -n monitoring
   ```

2. **Prometheus targets are up:**
   - Access Prometheus UI: `kubectl port-forward -n monitoring svc/prometheus-service 9090:9090`
   - Go to Status → Targets
   - Verify all targets show "UP" status

3. **Grafana data source works:**
   - Test connection in Data Sources
   - Run a test query: `up`

4. **Metrics are being collected:**
   - Check if you see data in imported dashboards
   - Verify node and pod metrics are populated

### 🔧 Troubleshooting

**Prometheus not scraping metrics:**
- Check RBAC permissions
- Verify service discovery configuration
- Check Prometheus logs: `kubectl logs -n monitoring deployment/prometheus`

**Grafana not showing data:**
- Verify data source URL: `http://prometheus-service:9090`
- Check if Prometheus is accessible from Grafana pod
- Verify dashboard queries match your label names

**Missing node metrics:**
- Ensure Node Exporter DaemonSet is running on all nodes
- Check node taints and tolerations

## Security Considerations

### Production Recommendations:

1. **Change default passwords:**
   ```yaml
   env:
   - name: GF_SECURITY_ADMIN_PASSWORD
     valueFrom:
       secretKeyRef:
         name: grafana-secret
         key: admin-password
   ```

2. **Use HTTPS:**
   - Configure TLS certificates
   - Use ingress controller with SSL termination

3. **Restrict access:**
   - Change LoadBalancer to ClusterIP
   - Use ingress with authentication

4. **Resource limits:**
   - Monitor Prometheus storage usage
   - Set up log rotation

## Advanced Configuration

### Alert Rules Example:
```yaml
# Add to prometheus-rules ConfigMap
groups:
- name: kubernetes-alerts
  rules:
  - alert: PodCrashLooping
    expr: increase(kube_pod_container_status_restarts_total[1h]) > 5
    for: 5m
    annotations:
      summary: "Pod {{ $labels.pod }} is crash looping"
```

### Resource Tuning:
- Adjust retention time: `--storage.tsdb.retention.time=30d`
- Scale Prometheus: Increase CPU/memory limits
- Use persistent storage for production

## Integration with AWS CloudWatch

Your CDK stack also includes Container Insights, which provides:
- Native AWS monitoring integration
- CloudWatch metrics and logs
- EKS control plane metrics
- Integration with AWS X-Ray for tracing

Access Container Insights in AWS Console: **CloudWatch > Container Insights > EKS Clusters** 