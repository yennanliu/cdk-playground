#!/usr/bin/env python3
import boto3
import json
import mysql.connector
import time
import sys

# ANSI colors for output
GREEN = '\033[0;32m'
RED = '\033[0;31m'
YELLOW = '\033[0;33m'
NC = '\033[0m'  # No Color

def print_success(message):
    print(f"{GREEN}✓ {message}{NC}")

def print_error(message):
    print(f"{RED}✗ {message}{NC}")

def print_warning(message):
    print(f"{YELLOW}! {message}{NC}")

def get_connection_parameters():
    """Get database connection parameters from AWS CloudFormation and Secrets Manager"""
    try:
        # Get endpoints from CloudFormation outputs
        cfn = boto3.client('cloudformation')
        response = cfn.describe_stacks(StackName='MysqlReadWriteReplicaStack')
        outputs = response['Stacks'][0]['Outputs']
        
        primary_endpoint = next(o['OutputValue'] for o in outputs if o['OutputKey'] == 'PrimaryEndpoint')
        read_endpoint = next(o['OutputValue'] for o in outputs if o['OutputKey'] == 'ReadReplicaEndpoint')
        
        # Get credentials from Secrets Manager
        sm = boto3.client('secretsmanager')
        secret_response = sm.get_secret_value(SecretId='mysql-primary-credentials')
        secret = json.loads(secret_response['SecretString'])
        
        username = secret['username']
        password = secret['password']
        
        return {
            'primary_endpoint': primary_endpoint,
            'read_endpoint': read_endpoint,
            'username': username,
            'password': password,
            'database': 'mydb'
        }
    except Exception as e:
        print_error(f"Failed to get connection parameters: {str(e)}")
        sys.exit(1)

def connect_to_database(host, username, password, database):
    """Connect to the MySQL database"""
    try:
        return mysql.connector.connect(
            host=host,
            user=username,
            password=password,
            database=database
        )
    except mysql.connector.Error as e:
        print_error(f"Failed to connect to {host}: {str(e)}")
        return None

def main():
    print("MySQL Primary/Replica Read-Write Separation Test")
    print("================================================")
    
    # Get connection parameters
    params = get_connection_parameters()
    
    print(f"Primary (Write) Endpoint: {params['primary_endpoint']}")
    print(f"Read Replica Endpoint: {params['read_endpoint']}")
    print("")
    
    # Test 1: Connect to primary and write data
    print("Test 1: Writing data to primary instance...")
    primary_conn = connect_to_database(
        params['primary_endpoint'], 
        params['username'], 
        params['password'], 
        params['database']
    )
    
    if not primary_conn:
        sys.exit(1)
    
    try:
        cursor = primary_conn.cursor()
        
        # Create test table if it doesn't exist
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS test_table (
            id INT AUTO_INCREMENT PRIMARY KEY,
            message VARCHAR(255) NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Insert test data
        test_message = f"Test message created at {time.strftime('%Y-%m-%d %H:%M:%S')}"
        cursor.execute("INSERT INTO test_table (message) VALUES (%s)", (test_message,))
        primary_conn.commit()
        
        # Verify data was written
        cursor.execute("SELECT * FROM test_table ORDER BY id DESC LIMIT 1")
        result = cursor.fetchone()
        
        if result and test_message in result:
            print_success("Successfully wrote data to primary instance")
        else:
            print_error("Failed to verify written data in primary instance")
            
    except mysql.connector.Error as e:
        print_error(f"Error during write test on primary: {str(e)}")
        primary_conn.close()
        sys.exit(1)
    
    # Test 2: Read from read replica (wait for replication)
    print("\nTest 2: Reading data from read replica (waiting for replication)...")
    print("Waiting 10 seconds for replication to complete...")
    time.sleep(10)
    
    read_conn = connect_to_database(
        params['read_endpoint'], 
        params['username'], 
        params['password'], 
        params['database']
    )
    
    if not read_conn:
        primary_conn.close()
        sys.exit(1)
    
    try:
        cursor = read_conn.cursor()
        cursor.execute("SELECT * FROM test_table ORDER BY id DESC LIMIT 1")
        result = cursor.fetchone()
        
        if result and test_message in result:
            print_success("Successfully read the latest data from read replica")
        else:
            print_warning("Read replica might be lagging behind - data not found or doesn't match")
            
    except mysql.connector.Error as e:
        print_error(f"Error during read test on replica: {str(e)}")
        primary_conn.close()
        read_conn.close()
        sys.exit(1)
    
    # Test 3: Try to write to read replica (should fail)
    print("\nTest 3: Attempting to write to read replica (should fail)...")
    
    try:
        cursor = read_conn.cursor()
        cursor.execute("INSERT INTO test_table (message) VALUES ('This should fail on read replica')")
        read_conn.commit()
        
        print_error("WARNING: Was able to write to read replica! This shouldn't happen.")
        
    except mysql.connector.Error as e:
        if "read-only" in str(e).lower():
            print_success("Write operation correctly failed on read replica (read-only mode)")
        else:
            print_warning(f"Write operation failed but for an unexpected reason: {str(e)}")
    
    # Clean up connections
    primary_conn.close()
    read_conn.close()
    
    print("\nAll tests completed.")
    print("================================================")

if __name__ == "__main__":
    main() 