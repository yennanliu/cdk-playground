# Testing MySQL Read-Write Separation

This README explains how to test that your MySQL read-write architecture is functioning correctly, ensuring that the primary instance handles write operations while the read replica is used for read-only operations.

## Prerequisites

For the shell script test:
- AWS CLI installed and configured
- MySQL client installed
- jq installed (for JSON parsing)
- Bash shell

For the Python test:
- Python 3.6+
- Required Python packages: `boto3`, `mysql-connector-python`
- AWS SDK configured

## Installation of Dependencies

```bash
# For the Python script
pip install boto3 mysql-connector-python

# For the shell script (Ubuntu/Debian)
apt-get update && apt-get install -y mysql-client jq

# For the shell script (Amazon Linux/RHEL/CentOS)
yum install -y mysql jq

# For the shell script (macOS)
brew install mysql-client jq
```

## Testing Options

### Option 1: Using the Shell Script

1. Make the script executable:
   ```bash
   chmod +x test-rw-separation.sh
   ```

2. Run the test:
   ```bash
   ./test-rw-separation.sh
   ```

### Option 2: Using the Python Script

1. Make the script executable:
   ```bash
   chmod +x test-rw-separation.py
   ```

2. Run the test:
   ```bash
   ./test-rw-separation.py
   ```

## What the Tests Verify

Both test scripts verify:

1. **Write to Primary**: The test attempts to create a table (if it doesn't exist) and insert a record into the primary MySQL instance.

2. **Read from Replica**: After waiting for replication to occur, the test reads from the read replica to verify that the data was replicated successfully.

3. **Write to Replica Fails**: The test attempts to write to the read replica, which should fail because read replicas are read-only by default in MySQL. This confirms that our separation of concerns (write to primary, read from replica) is enforced at the database level.

## Expected Results

- Writes to the primary instance should succeed
- Reads from the read replica should succeed (after a brief replication delay)
- Write attempts to the read replica should fail with a "read-only" error

## AWS RDS MySQL Read Replica Behavior

By default, MySQL read replicas in AWS RDS are configured as read-only instances. This is a configuration set by AWS and enforced by the MySQL engine itself. 

You can verify this by connecting to the read replica and running:

```sql
SHOW VARIABLES LIKE 'read_only';
```

This should return `ON` for read replicas.

## Additional Verification

To verify read-write separation in a real application:

1. Configure your application's data access layer to use the primary endpoint for write operations and the read replica endpoint for read operations.

2. Monitor the CloudWatch metrics for both instances to see the distribution of read and write operations.

3. Set up alarms for unexpected write operations on the read replica.

## Troubleshooting

If write operations succeed on the read replica, check:

1. That you're connecting to the correct endpoint
2. That the instance is actually configured as a read replica in RDS
3. AWS RDS settings to ensure read-only mode is enabled

If the test indicates that the read replica hasn't received the latest data:

1. Check the replication lag metrics in CloudWatch
2. Increase the sleep duration in the test script to allow more time for replication 