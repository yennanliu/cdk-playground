# EKS stack V2

## Prerequiste

```bash
# get AWS role id, name

aws sts get-caller-identity
```

## Run

```bash
# 1. Configure kubectl to connect to your EKS cluster.
#    You can get the correct command from the output of the cdk deploy command.
#    It should look like this (replace with your region and cluster name):


#aws eks update-kubeconfig --region <your-region> --name <your-cluster-name>

# EksStack2Stack.ConfigCommand = aws eks update-kubeconfig --region ap-northeast-1 --name EksClusterFAB68BDB-d58485b963184f869f7757fef19a31bd

aws eks update-kubeconfig --region ap-northeast-1 --name EksClusterFAB68BDB-d58485b963184f869f7757fef19a31bd


# 2. Apply the kubernetes manifest to deploy Kafka UI
kubectl apply -f k8s/kafka-ui-deployment.yaml

# 3. Check the status of your deployments
kubectl get deployments

# 4. Check the status of your services
kubectl get services
```
