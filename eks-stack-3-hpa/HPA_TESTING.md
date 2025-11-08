# Kubernetes Horizontal Pod Autoscaler (HPA) Testing Guide

This guide walks you through testing HPA functionality in the EKS cluster.

## Overview

This stack deploys:
- EKS Cluster with Kubernetes 1.31
- Metrics Server for resource metrics collection
- PHP-Apache test application with CPU resource requests
- HPA configured to scale based on 50% CPU utilization
- Min replicas: 1, Max replicas: 10

## Prerequisites

1. AWS CLI configured with appropriate credentials
2. kubectl installed
3. CDK CLI installed (`npm install -g aws-cdk`)

## Deployment

### 1. Deploy the Stack

```bash
# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Deploy to AWS
cdk deploy
```

### 2. Configure kubectl

After deployment, use the output command to configure kubectl:

```bash
aws eks update-kubeconfig --region <your-region> --name <cluster-name>
```

Or get the command from CDK outputs:
```bash
cdk deploy --outputs-file outputs.json
```

## Verification Steps

### Step 1: Verify Metrics Server

Wait 2-3 minutes after deployment for Metrics Server to be ready, then:

```bash
# Check Metrics Server deployment
kubectl get deployment metrics-server -n kube-system

# Verify metrics are being collected
kubectl top nodes
kubectl top pods -n kube-system
```

Expected output:
```
NAME           READY   UP-TO-DATE   AVAILABLE   AGE
metrics-server   1/1     1            1           5m
```

### Step 2: Verify PHP-Apache Application

```bash
# Check if the application is running
kubectl get deployment php-apache

# Check the pod
kubectl get pods -l app=php-apache

# Check the service
kubectl get service php-apache
```

Expected output:
```
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
php-apache   1/1     1            1           5m
```

### Step 3: Verify HPA

```bash
# Check HPA status
kubectl get hpa php-apache-hpa

# Get detailed HPA information
kubectl describe hpa php-apache-hpa
```

Expected output:
```
NAME              REFERENCE               TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
php-apache-hpa    Deployment/php-apache   0%/50%    1         10        1          5m
```

The `TARGETS` column shows: `<current-cpu>/<target-cpu>`

## HPA Load Testing

### Method 1: Using BusyBox Load Generator (Recommended)

This method runs a load generator inside the cluster.

**Terminal 1: Start Load Generator**
```bash
kubectl run -i --tty load-generator --rm --image=busybox --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://php-apache; done"
```

This creates a pod that continuously sends requests to the PHP-Apache service.

**Terminal 2: Watch HPA Scaling**
```bash
kubectl get hpa php-apache-hpa -w
```

You should see the CPU utilization increase:
```
NAME              REFERENCE               TARGETS    MINPODS   MAXPODS   REPLICAS   AGE
php-apache-hpa    Deployment/php-apache   0%/50%     1         10        1          10m
php-apache-hpa    Deployment/php-apache   45%/50%    1         10        1          11m
php-apache-hpa    Deployment/php-apache   78%/50%    1         10        1          12m
php-apache-hpa    Deployment/php-apache   78%/50%    1         10        2          12m
php-apache-hpa    Deployment/php-apache   52%/50%    1         10        4          13m
```

**Terminal 3: Watch Pods Scaling**
```bash
kubectl get pods -l app=php-apache -w
```

You should see new pods being created:
```
NAME                          READY   STATUS    RESTARTS   AGE
php-apache-5d4f8d7b9c-abc12   1/1     Running   0          15m
php-apache-5d4f8d7b9c-def34   0/1     Pending   0          0s
php-apache-5d4f8d7b9c-def34   0/1     ContainerCreating   0          1s
php-apache-5d4f8d7b9c-def34   1/1     Running             0          3s
```

**Stop Load Test:**
Press `Ctrl+C` in Terminal 1 to stop the load generator.

### Method 2: Using Multiple Load Generators

For more aggressive scaling:

```bash
# Start 3 load generators in separate terminals
kubectl run load-generator-1 -i --tty --rm --image=busybox --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://php-apache; done"

kubectl run load-generator-2 -i --tty --rm --image=busybox --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://php-apache; done"

kubectl run load-generator-3 -i --tty --rm --image=busybox --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://php-apache; done"
```

### Method 3: Using Apache Bench (from local machine)

First, expose the service:

```bash
# Port forward to access the service locally
kubectl port-forward service/php-apache 8080:80
```

Then in another terminal:
```bash
# Install Apache Bench (if not installed)
# macOS: brew install httpd (includes ab)
# Ubuntu: sudo apt-get install apache2-utils

# Generate load
ab -n 500000 -c 100 http://localhost:8080/
```

## Expected Behavior

### Scale-Up Behavior
- **Trigger**: CPU utilization exceeds 50%
- **Stabilization Window**: 60 seconds
- **Scaling Policy**: Can add up to 100% more pods or 4 pods (whichever is larger) every 15 seconds
- **Timeline**:
  - 0 min: 1 replica at 0% CPU
  - 1-2 min: CPU rises to 70-80% under load
  - 2-3 min: HPA adds replicas (2-4 pods)
  - 3-5 min: CPU stabilizes around 50% with multiple replicas

### Scale-Down Behavior
- **Trigger**: CPU utilization drops below 50%
- **Stabilization Window**: 300 seconds (5 minutes)
- **Scaling Policy**: Can remove up to 50% of pods every 15 seconds
- **Timeline**:
  - Stop load
  - Wait 5 minutes (stabilization period)
  - HPA gradually reduces replicas back to 1

## Monitoring Commands

```bash
# Watch HPA status
kubectl get hpa php-apache-hpa -w

# Watch pod count
kubectl get pods -l app=php-apache -w

# Watch pod resource usage
watch kubectl top pods -l app=php-apache

# Get HPA events
kubectl describe hpa php-apache-hpa

# Get pod events
kubectl get events --sort-by='.lastTimestamp' | grep php-apache
```

## Troubleshooting

### Metrics Server Not Working

```bash
# Check Metrics Server logs
kubectl logs -n kube-system deployment/metrics-server

# Common issues:
# 1. Metrics Server needs time to start (wait 2-3 minutes)
# 2. Check if nodes are ready: kubectl get nodes
```

### HPA Shows "unknown" for Targets

```bash
# This usually means Metrics Server isn't ready yet
kubectl get apiservice v1beta1.metrics.k8s.io -o yaml

# Wait a few minutes and check again
kubectl get hpa php-apache-hpa
```

### HPA Not Scaling

```bash
# Check if resource requests are defined
kubectl get deployment php-apache -o yaml | grep -A 5 resources

# Check HPA events for errors
kubectl describe hpa php-apache-hpa

# Verify metrics are available
kubectl top pods -l app=php-apache
```

### Load Generator Not Creating Load

```bash
# Test service connectivity from another pod
kubectl run test-pod --rm -i --tty --image=busybox --restart=Never -- wget -O- http://php-apache

# Check if service is working
kubectl get svc php-apache
kubectl get endpoints php-apache
```

## Understanding HPA Configuration

The HPA is configured with these settings:

```yaml
minReplicas: 1          # Never scale below 1 pod
maxReplicas: 10         # Never scale above 10 pods
targetCPUUtilization: 50%  # Target 50% average CPU across all pods

behavior:
  scaleUp:
    stabilizationWindowSeconds: 60    # Wait 60s before scaling up again
    policies:
      - type: Percent
        value: 100                     # Can double pod count
        periodSeconds: 15
      - type: Pods
        value: 4                       # Or add 4 pods
        periodSeconds: 15
    selectPolicy: Max                  # Use the larger of the two policies

  scaleDown:
    stabilizationWindowSeconds: 300   # Wait 5 minutes before scaling down
    policies:
      - type: Percent
        value: 50                      # Can remove 50% of pods
        periodSeconds: 15
```

### How CPU Utilization is Calculated

HPA uses the formula:
```
desiredReplicas = ceil[currentReplicas * (currentMetricValue / targetMetricValue)]
```

Example:
- Current: 2 pods, 80% average CPU
- Target: 50% CPU
- Calculation: ceil[2 * (80 / 50)] = ceil[3.2] = 4 pods

## Resource Requests Explained

The PHP-Apache deployment has these resource settings:

```yaml
resources:
  requests:
    cpu: 200m      # 0.2 CPU cores
    memory: 128Mi
  limits:
    cpu: 500m      # 0.5 CPU cores
    memory: 256Mi
```

- **requests**: Guaranteed resources; used by HPA for percentage calculations
- **limits**: Maximum resources the container can use
- **CPU units**: 1000m = 1 CPU core, 200m = 0.2 cores (20% of a core)

When HPA shows "50% CPU", it means the pod is using 100m (50% of the 200m request).

## Cleanup

To destroy the stack and all resources:

```bash
cdk destroy
```

## Cost Considerations

Running this stack costs approximately:
- 2x t3.medium nodes: ~$60/month
- EKS cluster: $0.10/hour = ~$73/month
- Data transfer: varies
- **Total**: ~$133/month

For testing only, remember to destroy the stack when done!

## Additional Resources

- [Kubernetes HPA Documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Kubernetes HPA Walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/)
- [AWS EKS Best Practices - Autoscaling](https://aws.github.io/aws-eks-best-practices/karpenter/)
- [Metrics Server GitHub](https://github.com/kubernetes-sigs/metrics-server)

## Example Testing Session

Here's a complete example of a testing session:

```bash
# 1. Deploy
cdk deploy

# 2. Configure kubectl (use output from deploy)
aws eks update-kubeconfig --region us-east-1 --name EksStack3HpaStack-EksCluster

# 3. Wait for Metrics Server (2-3 minutes)
kubectl get deployment metrics-server -n kube-system -w

# 4. Verify everything is ready
kubectl get hpa php-apache-hpa
# Should show: 0%/50%

# 5. Open 3 terminals:

# Terminal 1: Start load
kubectl run -i --tty load-generator --rm --image=busybox --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://php-apache; done"

# Terminal 2: Watch HPA
kubectl get hpa php-apache-hpa -w

# Terminal 3: Watch pods
kubectl get pods -l app=php-apache -w

# 6. Observe scaling (2-5 minutes)
# You should see pods increase from 1 to multiple replicas

# 7. Stop load (Ctrl+C in Terminal 1)

# 8. Watch scale-down (5+ minutes)
# Pods will gradually decrease back to 1

# 9. Cleanup
cdk destroy
```
