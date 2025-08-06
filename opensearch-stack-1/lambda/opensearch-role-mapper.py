import json
import urllib3
import base64
import time
import logging
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Disable SSL warnings for self-signed certificates (if needed)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Lambda function to configure OpenSearch role mapping for Firehose integration.
    
    Expected event payload:
    {
        "domainEndpoint": "https://search-domain-name.region.es.amazonaws.com",
        "firehoseRoleArn": "arn:aws:iam::account:role/FirehoseRole",
        "masterUser": "admin",
        "masterPassword": "password",
        "RequestType": "Create|Update|Delete"
    }
    """
    
    logger.info(f"Received event: {json.dumps(event, indent=2)}")
    
    try:
        request_type = event.get('RequestType')
        
        if request_type == 'Delete':
            # For delete operations, we'll just return success
            # Role mappings don't need to be cleaned up
            logger.info("Delete operation - no cleanup needed for role mappings")
            return {
                'statusCode': 200,
                'body': json.dumps({'Message': 'Delete completed successfully'})
            }
        
        # Extract parameters
        domain_endpoint = event['domainEndpoint']
        firehose_role_arn = event['firehoseRoleArn']
        master_user = event['masterUser']
        master_password = event['masterPassword']
        
        # Ensure domain endpoint starts with https://
        if not domain_endpoint.startswith('https://'):
            domain_endpoint = f"https://{domain_endpoint}"
        
        logger.info(f"Configuring role mapping for domain: {domain_endpoint}")
        logger.info(f"Firehose role ARN: {firehose_role_arn}")
        
        # Configure role mapping for delivery role
        success = configure_role_mapping(
            domain_endpoint=domain_endpoint,
            role_arn=firehose_role_arn,
            role_name='all_access',
            master_user=master_user,
            master_password=master_password
        )
        
        if success:
            logger.info("Role mapping configured successfully")
            return {
                'statusCode': 200,
                'body': json.dumps({'Message': 'Role mapping completed successfully'})
            }
        else:
            logger.error("Failed to configure role mapping")
            return {
                'statusCode': 500,
                'body': json.dumps({'Error': 'Failed to configure role mapping'})
            }
            
    except Exception as e:
        logger.error(f"Error processing event: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'Error': str(e)})
        }

def configure_role_mapping(domain_endpoint: str, role_arn: str, role_name: str, 
                         master_user: str, master_password: str) -> bool:
    """
    Configure OpenSearch role mapping for the given role.
    
    Args:
        domain_endpoint: OpenSearch domain endpoint
        role_arn: IAM role ARN to map
        role_name: OpenSearch role name to assign
        master_user: Master username for authentication
        master_password: Master password for authentication
    
    Returns:
        bool: True if successful, False otherwise
    """
    
    http = urllib3.PoolManager()
    
    # Create basic auth header
    credentials = f"{master_user}:{master_password}"
    credentials_b64 = base64.b64encode(credentials.encode('utf-8')).decode('utf-8')
    headers = {
        'Authorization': f'Basic {credentials_b64}',
        'Content-Type': 'application/json'
    }
    
    # Role mapping payload
    role_mapping = {
        "backend_roles": [role_arn],
        "hosts": [],
        "users": []
    }
    
    # API endpoint for role mapping
    url = f"{domain_endpoint}/_plugins/_security/api/rolesmapping/{role_name}"
    
    try:
        logger.info(f"Creating role mapping at: {url}")
        
        response = http.request(
            'PUT',
            url,
            body=json.dumps(role_mapping),
            headers=headers,
            timeout=30
        )
        
        logger.info(f"Response status: {response.status}")
        logger.info(f"Response data: {response.data.decode('utf-8')}")
        
        if response.status in [200, 201]:
            logger.info(f"Successfully configured role mapping for {role_name}")
            return True
        else:
            logger.error(f"Failed to configure role mapping. Status: {response.status}")
            return False
            
    except Exception as e:
        logger.error(f"Exception during role mapping configuration: {str(e)}")
        return False

def wait_for_domain_ready(domain_endpoint: str, master_user: str, master_password: str, 
                         max_retries: int = 10, delay: int = 30) -> bool:
    """
    Wait for OpenSearch domain to be ready.
    
    Args:
        domain_endpoint: OpenSearch domain endpoint
        master_user: Master username
        master_password: Master password
        max_retries: Maximum number of retry attempts
        delay: Delay between retries in seconds
    
    Returns:
        bool: True if domain is ready, False otherwise
    """
    
    http = urllib3.PoolManager()
    credentials = f"{master_user}:{master_password}"
    credentials_b64 = base64.b64encode(credentials.encode('utf-8')).decode('utf-8')
    headers = {
        'Authorization': f'Basic {credentials_b64}'
    }
    
    health_url = f"{domain_endpoint}/_cluster/health"
    
    for attempt in range(max_retries):
        try:
            logger.info(f"Checking domain health (attempt {attempt + 1}/{max_retries})")
            
            response = http.request('GET', health_url, headers=headers, timeout=30)
            
            if response.status == 200:
                health_data = json.loads(response.data.decode('utf-8'))
                status = health_data.get('status', 'unknown')
                
                logger.info(f"Cluster status: {status}")
                
                if status in ['green', 'yellow']:
                    logger.info("Domain is ready")
                    return True
                    
            logger.info(f"Domain not ready yet. Waiting {delay} seconds...")
            time.sleep(delay)
            
        except Exception as e:
            logger.warning(f"Health check failed (attempt {attempt + 1}): {str(e)}")
            time.sleep(delay)
    
    logger.error("Domain failed to become ready within timeout period")
    return False