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

# aws eks update-kubeconfig --region ap-northeast-1 --name EksClusterFAB68BDB-d58485b963184f869f7757fef19a31bd

aws eks update-kubeconfig --region ap-northeast-1 --name EksClusterFAB68BDB-fc53a709a4ca4255bdebf1238a295627


# 2. Apply the kubernetes manifest to deploy Kafka UI
kubectl apply -f k8s/kafka-ui-deployment.yaml

kubectl apply -f k8s/mongo-deployment.yaml

kubectl apply -f k8s/kafka-zk-kafkaUI-deployment.yaml

kubectl apply -f k8s/java-maze-app-deployment.yaml

kubectl apply -f k8s/airflow/airflow-deployment.yaml


kubectl create namespace monitoring
kubectl apply -f k8s/prometheus/prometheus-grafana-deployment.yaml

bash k8s/prometheus/deploy-monitoring.sh


# 2-1 Destroy pods
kubectl delete -f k8s/kafka-ui-deployment.yaml

kubectl delete -f k8s/mongo-deployment.yaml

kubectl delete -f k8s/kafka-zk-kafkaUI-deployment.yaml

kubectl delete -f k8s/java-maze-app-deployment.yaml

kubectl delete -f k8s/airflow/airflow-deployment.yaml

# 3. Check the status of your deployments
kubectl get deployments

# 4. Check the status of your services
kubectl get services

# 5. get pod logs
kubectl logs kafka-f476556c8-w2bvq
kubectl logs <pod_name>

# get external port:

#-----------------------
# 1) Kafka UI
#-----------------------

kubectl port-forward service/kafka-ui-primary-service 9999:80
# 127.0.0.1:9999

kubectl port-forward service/kafka-ui-secondary-service 8082:80
# 127.0.0.1:8082


#-----------------------
# 2) Mongo Express
#-----------------------
kubectl port-forward mongo-express-service 8081:8081
#http://localhost:8081/

# account: admin
# pwd: admin123


#-----------------------
# 3) Kafka broker, ZK, UI
#-----------------------

kubectl port-forward service/kafka-ui-service 9997:80
# 127.0.0.1:9997

kubectl port-forward service/kafka 9092:9092
# 127.0.0.1:9092


#-----------------------
# 4) Maze Java app
#-----------------------

kubectl port-forward service/maze-app-service 7777:80
# 127.0.0.1:7777

#-----------------------
# 5) Airflow
#-----------------------

kubectl port-forward service/airflow-webserver 9999:8080



#-----------------------
# 6) grafana
#-----------------------

kubectl get services -n monitoring

kubectl port-forward service/grafana-service 4000:3000 -n monitoring
# account: admin
# pwd: admin (Admin_123)
```


- Spark Hadoop deployment

```bash

#-------------------
# V1
#-------------------

kubectl apply -f k8s/spark_hadoop/hadoop-namenode-deployment.yaml

kubectl apply -f k8s/spark_hadoop/hadoop-datanode-deployment.yaml

kubectl apply -f k8s/spark_hadoop/spark-master-deployment.yaml

kubectl apply -f k8s/spark_hadoop/spark-worker-deployment.yaml

#-------------------
# V2
#-------------------

kubectl delete -f k8s/spark_hadoop

kubectl apply -f k8s/spark_hadoop/


#-------------
# Forward port for local access
#-------------
kubectl port-forward svc/hadoop-namenode 9870:9870 9000:9000


kubectl port-forward svc/spark-master 8080:8080 7077:7077


# Hadoop NameNode:
# UI: localhost:9870 -> 9870
# HDFS: localhost:9000 -> 9000
# Spark Master:
# UI: localhost:8080 -> 8080
# Spark: localhost:7077 -> 7077


#-------------
# delete pods, resources
#-------------


kubectl delete -f k8s/spark_hadoop

kubectl delete pods --all --force --grace-period=0

kubectl delete jobs --all --force --grace-period=0

kubectl delete configmap spark-wordcount

kubectl get pods,jobs,configmaps
```