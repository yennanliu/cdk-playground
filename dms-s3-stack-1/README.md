# MySQL to S3 CDC Stack with AWS DMS

This CDK project implements a Change Data Capture (CDC) pipeline from MySQL to Amazon S3 using AWS Database Migration Service (DMS). The stack automatically provisions and configures all necessary AWS resources for a complete CDC solution.

## Run

```bash

# deploy CDK
npm install

cdk bootstrap

cdk deploy

# connect to MYSQL
/opt/homebrew/opt/mysql-client/bin/mysql -h <rds_url> -P 3306 -u admin -p

# create, insert fake data to DB
# check code under /sql/


# NOTE !!!
# go to AWS DNS UI Page
# test endpoints connection
# then enable DNS task

# https://ap-northeast-1.console.aws.amazon.com/dms/v2/home?region=ap-northeast-1#tasks/provisioned/dmsreplicationtask-ptt49ulopdfgj3x7


# then the dns can work
```

## Architecture

```ascii
+-------------------+        +-------------------------+         +------------------+
|                   |        |                         |         |                  |
|  MySQL RDS        +------->+      AWS DMS Task       +-------->+   Amazon S3      |
|  (source DB)      |  CDC   | (Change Data Capture)   |  JSON   |  (bucket: cdc/)  |
|                   |        |                         |         |                  |
+-------------------+        +-------------------------+         +------------------+
```

## Stack Components

The CDK stack creates the following resources:

- **VPC Infrastructure**
  - VPC with public and private subnets
  - NAT Gateway for private subnet connectivity
  - Security groups for RDS and DMS

- **Source Database**
  - Amazon RDS MySQL 8.0 instance
  - Publicly accessible for testing
  - Automated password management via Secrets Manager

- **AWS DMS Resources**
  - DMS Replication Instance (t3.micro)
  - DMS Subnet Group for VPC deployment
  - Source endpoint (MySQL)
  - Target endpoint (S3)
  - Replication task configured for Full Load + CDC

- **S3 Configuration**
  - S3 bucket for CDC data
  - Appropriate IAM roles and policies

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js and npm installed
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Deployment Instructions

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd dms-s3-stack-1
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Deploy the stack:
   ```bash
   cdk deploy
   ```

   The deployment will output important information:
   - RDS endpoint
   - S3 bucket name
   - RDS secret name (for database credentials)

## Testing the CDC Pipeline

1. Get the RDS credentials from Secrets Manager:
   ```bash
   aws secretsmanager get-secret-value --secret-id <RDS_SECRET_NAME>
   ```

2. Connect to the RDS instance using any MySQL client:
   ```bash
   mysql -h <RDS_ENDPOINT> -u admin -p
   ```

3. Create a test database and table:
   ```sql
   CREATE DATABASE mydb;
   USE mydb;
   CREATE TABLE users (
     id INT PRIMARY KEY,
     name VARCHAR(100),
     created_at TIMESTAMP
   );
   ```

4. Insert some test data and watch it appear in the S3 bucket:
   ```sql
   INSERT INTO users VALUES (1, 'Test User', NOW());
   ```

## Security Considerations

- The RDS instance is publicly accessible for testing purposes
- In production, consider:
  - Restricting RDS access to specific IP ranges
  - Enabling encryption at rest
  - Using private subnets only
  - Implementing more strict security group rules

## Clean Up

To avoid incurring charges, delete the stack when you're done:
```bash
cdk destroy
```

## Useful CDK Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template