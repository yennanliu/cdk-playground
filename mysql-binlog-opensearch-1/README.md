# MySQL Binlog to OpenSearch Real-Time Data Pipeline

This AWS CDK TypeScript project implements a real-time data pipeline that captures MySQL binary log (binlog) events and streams them to Amazon OpenSearch Service via Amazon Kinesis Data Streams and Kinesis Data Firehose.

## Architecture Overview

```
MySQL RDS → ECS Fargate (Binlog Reader) → Kinesis Data Streams → Kinesis Firehose → OpenSearch Service
    ↓                                                                    ↓
Secrets Manager                                                    Lambda (Transform)
                                                                         ↓
                                                                   S3 (Backup)
```

## Components

### Infrastructure Components
- **VPC**: Multi-AZ VPC with public and private subnets
- **RDS MySQL**: Publicly accessible MySQL instance with binary logging enabled
- **ECS Fargate**: Container service running custom binlog reader
- **Kinesis Data Streams**: Real-time data streaming service
- **Kinesis Data Firehose**: Data delivery service to OpenSearch
- **OpenSearch Service**: Search and analytics engine
- **Lambda**: Data transformation function
- **S3**: Backup storage for Firehose
- **Secrets Manager**: Secure storage for database credentials
- **CloudWatch**: Logging and monitoring
- **IAM**: Roles and policies for service permissions

### Key Features
- ✅ **Real-time CDC**: Captures MySQL changes in real-time via binlog
- ✅ **Scalable Architecture**: Uses managed services for high availability
- ✅ **Secure**: Database credentials stored in Secrets Manager
- ✅ **Monitoring**: CloudWatch integration for logs and metrics
- ✅ **Data Transformation**: Lambda function for data processing
- ✅ **Backup**: S3 backup for data durability

## Prerequisites

1. **AWS CLI** configured with appropriate permissions
2. **Node.js** (v14 or later)
3. **AWS CDK** installed globally:
   ```bash
   npm install -g aws-cdk
   ```

## Quick Start

### 1. Clone and Setup
```bash
git clone <your-repo>
cd mysql-binlog-opensearch-1
npm install
```

### 2. Deploy the Infrastructure
```bash
# Option 1: Use the deployment script
./deploy.sh

# Option 2: Manual deployment
npm run build
cdk bootstrap  # Only needed once per account/region
cdk deploy
```

### 3. Post-Deployment Setup

After deployment, note the output values:
- `DatabaseEndpoint`: MySQL RDS endpoint
- `DatabaseCredentialsSecret`: Secret ARN for DB credentials
- `OpenSearchDomainEndpoint`: OpenSearch cluster endpoint
- `KinesisStreamName`: Kinesis stream name

## Testing the Pipeline

### 1. Connect to MySQL
```bash
# Get database credentials
aws secretsmanager get-secret-value --secret-id mysql-binlog-db-credentials

# Connect to MySQL (replace with your endpoint)
mysql -h <database-endpoint> -u admin -p
```

### 2. Create Test Data
```sql
USE debezium;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (name, email) VALUES 
    ('John Doe', 'john@example.com'),
    ('Jane Smith', 'jane@example.com');

UPDATE users SET name = 'John Updated' WHERE id = 1;
DELETE FROM users WHERE id = 2;
```

### 3. Verify Data in OpenSearch
```bash
# Access OpenSearch endpoint (from CDK output)
curl -X GET "https://<opensearch-endpoint>/binlog-events/_search?pretty"
```

## Configuration

### MySQL Parameters
The RDS instance is configured with:
- `log-bin`: mysql-bin
- `binlog_format`: ROW
- `binlog_row_image`: FULL
- `expire_logs_days`: 1

### Kinesis Configuration
- **Stream**: 1 shard with 24-hour retention
- **Firehose**: 60-second buffering, GZIP compression
- **Index**: `binlog-events` in OpenSearch

## Monitoring

### CloudWatch Logs
- `/ecs/mysql-kinesis`: ECS container logs
- `/aws/lambda/<function-name>`: Lambda transformation logs

### Key Metrics to Monitor
- Kinesis stream incoming records
- Firehose delivery success rate
- ECS task health
- OpenSearch indexing rate

## Customization

### Custom Binlog Reader
The current implementation uses a Python-based binlog reader. For production:

1. **Build Custom Image**: Create a Docker image with optimized binlog processing
2. **Add Filtering**: Implement table/database filtering logic
3. **Error Handling**: Add robust error handling and retry mechanisms
4. **Monitoring**: Add custom metrics and alerting

### Data Transformation
Modify the Lambda function in the CDK stack to:
- Add custom field mappings
- Implement data validation
- Add enrichment logic

## Troubleshooting

### Common Issues

1. **ECS Task Not Starting**
   - Check CloudWatch logs: `/ecs/mysql-kinesis`
   - Verify IAM permissions
   - Ensure security groups allow MySQL access

2. **No Data in OpenSearch**
   - Verify Kinesis stream has incoming data
   - Check Firehose delivery logs
   - Validate Lambda transformation function

3. **MySQL Connection Issues**
   - Ensure RDS is publicly accessible
   - Check security group rules
   - Verify database credentials in Secrets Manager

### Debugging Commands
```bash
# Check ECS service status
aws ecs describe-services --cluster mysql-binlog-cluster --services <service-name>

# View Kinesis stream metrics
aws kinesis describe-stream --stream-name mysql-binlog-stream

# Check Firehose delivery stream
aws firehose describe-delivery-stream --delivery-stream-name mysql-binlog-firehose
```

## Security Considerations

- Database credentials are stored in AWS Secrets Manager
- ECS tasks run in private subnets with NAT Gateway access
- OpenSearch domain is deployed in VPC with security groups
- IAM roles follow least privilege principle

## Cost Optimization

- RDS uses t3.micro instance (adjust based on load)
- OpenSearch uses t3.small.search (single node for demo)
- Kinesis has minimal shard count
- Lambda pricing is pay-per-use

## Cleanup

To avoid ongoing charges:
```bash
cdk destroy
```

## Production Considerations

1. **High Availability**: Deploy across multiple AZs
2. **Scaling**: Use Auto Scaling for ECS and multiple Kinesis shards
3. **Security**: Implement VPC endpoints, encrypt data at rest/transit
4. **Monitoring**: Set up CloudWatch alarms and notifications
5. **Backup**: Implement automated backups for RDS and OpenSearch

## Useful Commands

* `npm run build`   - Compile TypeScript to JavaScript
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Run Jest unit tests
* `cdk deploy`      - Deploy stack to AWS
* `cdk diff`        - Compare deployed stack with current state
* `cdk synth`       - Generate CloudFormation template
* `cdk destroy`     - Delete the stack and all resources

## Support

For issues and questions:
1. Check CloudWatch logs for detailed error messages
2. Review AWS documentation for service-specific troubleshooting
3. Ensure all prerequisites are met and AWS credentials are configured

---

**⚠️ Important**: This is a demo implementation. For production use, consider implementing proper error handling, monitoring, security hardening, and cost optimization strategies.
