# Airflow on AWS ECS CDK Project

This project creates an AWS infrastructure for running Apache Airflow on ECS Fargate using the AWS CDK.

## Architecture

This stack sets up a complete infrastructure for running Apache Airflow:

- **VPC**: With public and private subnets across two availability zones
- **ECS Cluster**: For running Airflow components as Fargate tasks
- **RDS PostgreSQL**: Backend database for Airflow metadata
- **ElastiCache Redis**: For Celery Executor task queue
- **Airflow Components**: Webserver, Scheduler, Worker, and Triggerer containers
- **Application Load Balancer**: For accessing the Airflow webserver UI
- **IAM Roles**: For secure access to AWS resources
- **Security Groups**: For controlling network traffic
- **CloudWatch Logs**: For logging Airflow container outputs

## Usage

### Deployment

1. Install dependencies:
```
npm install
```

2. Build the project:
```
npm run build
```

3. Deploy to AWS:
```
cdk deploy
```

### Accessing Airflow

Once deployed, you can access the Airflow UI via the Application Load Balancer URL that will be displayed in the CDK outputs.

The default credentials are:
- Username: `airflow`
- Password: `airflow`

### Adding DAGs

To add your own DAGs, you can customize the stack to include an EFS volume or use a custom Docker image with your DAGs built in.

## Cleanup

To remove all resources:

```
cdk destroy
```

## Notes

This implementation uses Apache Airflow 3.0.1 and runs it using the Celery Executor for distributed task processing.
