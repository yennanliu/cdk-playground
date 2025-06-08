# Airflow ECS 3

## Run

```bash

npm install

cdk bootstrap

cdk deploy  


# upload DAG python code to s3
aws s3 cp your-dag.py s3://your-dags-bucket-name/dags/
```

