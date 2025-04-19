#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "MySQL Primary/Replica Read-Write Separation Test"
echo "================================================"

# Get endpoints from CloudFormation outputs
PRIMARY_ENDPOINT=$(aws cloudformation describe-stacks --stack-name MysqlReadWriteReplicaStack --query "Stacks[0].Outputs[?OutputKey=='PrimaryEndpoint'].OutputValue" --output text)
READ_ENDPOINT=$(aws cloudformation describe-stacks --stack-name MysqlReadWriteReplicaStack --query "Stacks[0].Outputs[?OutputKey=='ReadReplicaEndpoint'].OutputValue" --output text)

# Get the database password from Secrets Manager
DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id mysql-primary-credentials --query 'SecretString' --output text | jq -r '.password')
DB_USERNAME="admin"
DB_NAME="mydb"

echo "Primary (Write) Endpoint: $PRIMARY_ENDPOINT"
echo "Read Replica Endpoint: $READ_ENDPOINT"
echo ""

# Test 1: Write to primary
echo "Test 1: Writing data to primary instance..."
mysql -h $PRIMARY_ENDPOINT -u $DB_USERNAME -p$DB_PASSWORD $DB_NAME << EOF
CREATE TABLE IF NOT EXISTS test_table (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO test_table (message) VALUES ('Test message from primary instance');
SELECT * FROM test_table;
EOF

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Successfully wrote to primary instance${NC}"
else
  echo -e "${RED}✗ Failed to write to primary instance${NC}"
  exit 1
fi

# Test 2: Read from replica (with delay to allow replication)
echo ""
echo "Test 2: Reading data from read replica (waiting for replication)..."
echo "Waiting 10 seconds for replication to complete..."
sleep 10

mysql -h $READ_ENDPOINT -u $DB_USERNAME -p$DB_PASSWORD $DB_NAME << EOF
SELECT * FROM test_table;
EOF

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Successfully read from read replica${NC}"
else
  echo -e "${RED}✗ Failed to read from read replica${NC}"
  exit 1
fi

# Test 3: Try to write to read replica (should fail)
echo ""
echo "Test A3: Attempting to write to read replica (should fail)..."
set +e # Don't exit on error for this test
mysql -h $READ_ENDPOINT -u $DB_USERNAME -p$DB_PASSWORD $DB_NAME << EOF
INSERT INTO test_table (message) VALUES ('This should fail on read replica');
EOF

if [ $? -ne 0 ]; then
  echo -e "${GREEN}✓ Write operation correctly failed on read replica${NC}"
else
  echo -e "${RED}✗ WARNING: Was able to write to read replica!${NC}"
fi
set -e

echo ""
echo "All tests completed."
echo "================================================" 