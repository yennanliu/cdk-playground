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
        "RequestType": "Create|Update|Delete",
        "ResponseURL": "...",
        "StackId": "...",
        "RequestId": "...",
        "LogicalResourceId": "..."
    }
    """
    
    logger.info(f"Received event: {json.dumps(event, indent=2)}")
    
    # CloudFormation Custom Resource response helper
    def send_response(response_status: str, response_data: Dict[str, Any] = None, reason: str = None):
        response_body = {
            'Status': response_status,
            'Reason': reason or f'See CloudWatch Log Stream: {context.log_stream_name}',
            'PhysicalResourceId': event.get('LogicalResourceId', 'opensearch-role-mapper'),
            'StackId': event['StackId'],
            'RequestId': event['RequestId'],
            'LogicalResourceId': event['LogicalResourceId'],
            'Data': response_data or {}
        }
        
        json_response_body = json.dumps(response_body)
        logger.info(f"Response body: {json_response_body}")
        
        headers = {
            'content-type': '',
            'content-length': str(len(json_response_body))
        }
        
        try:
            http = urllib3.PoolManager()
            response = http.request('PUT', event['ResponseURL'], 
                                  body=json_response_body, 
                                  headers=headers)
            logger.info(f"CloudFormation response status: {response.status}")
        except Exception as e:
            logger.error(f"Failed to send response to CloudFormation: {str(e)}")
    
    try:
        request_type = event.get('RequestType')
        
        if request_type == 'Delete':
            # For delete operations, we'll just return success
            # Role mappings don't need to be cleaned up
            logger.info("Delete operation - no cleanup needed for role mappings")
            send_response('SUCCESS', {'Message': 'Delete completed'})
            return {'statusCode': 200}
        
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
        
        # Wait for domain to be ready (with retries)
        max_retries = 10
        for attempt in range(max_retries):
            try:
                # Test domain connectivity
                http = urllib3.PoolManager()
                
                # Create basic auth header
                credentials = f"{master_user}:{master_password}"
                encoded_credentials = base64.b64encode(credentials.encode()).decode()
                
                headers = {
                    'Authorization': f'Basic {encoded_credentials}',
                    'Content-Type': 'application/json'
                }
                
                # Test domain health
                health_url = f"{domain_endpoint}/_cluster/health"
                response = http.request('GET', health_url, headers=headers, timeout=30)
                
                if response.status == 200:
                    logger.info(f"Domain is ready (attempt {attempt + 1})")
                    break
                else:
                    logger.warning(f"Domain not ready yet (attempt {attempt + 1}): status {response.status}")
                    
            except Exception as e:
                logger.warning(f"Domain connectivity test failed (attempt {attempt + 1}): {str(e)}")
            
            if attempt < max_retries - 1:
                time.sleep(30)  # Wait 30 seconds between retries
            else:
                raise Exception(f"Domain not ready after {max_retries} attempts")
        
        # Get current role mapping
        role_mapping_url = f"{domain_endpoint}/_plugins/_security/api/rolesmapping/all_access"
        
        logger.info("Fetching current role mapping...")
        response = http.request('GET', role_mapping_url, headers=headers, timeout=30)
        
        if response.status == 200:
            current_mapping = json.loads(response.data.decode('utf-8'))
            logger.info(f"Current role mapping: {json.dumps(current_mapping, indent=2)}")
        else:
            logger.warning(f"Failed to get current role mapping: {response.status}")
            current_mapping = {"all_access": {"hosts": [], "users": [], "backend_roles": []}}
        
        # Prepare new role mapping
        all_access_mapping = current_mapping.get("all_access", {})
        backend_roles = all_access_mapping.get("backend_roles", [])
        users = all_access_mapping.get("users", [])
        hosts = all_access_mapping.get("hosts", [])
        
        # Add Firehose role if not already present
        if firehose_role_arn not in backend_roles:
            backend_roles.append(firehose_role_arn)
            logger.info(f"Adding Firehose role to backend_roles")
        else:
            logger.info(f"Firehose role already in backend_roles")
        
        # Ensure admin user is present
        if master_user not in users:
            users.append(master_user)
        
        # Update role mapping
        new_mapping = {
            "backend_roles": backend_roles,
            "hosts": hosts,
            "users": users
        }
        
        logger.info(f"Updating role mapping with: {json.dumps(new_mapping, indent=2)}")
        
        response = http.request('PUT', role_mapping_url, 
                               body=json.dumps(new_mapping),
                               headers=headers, 
                               timeout=30)
        
        if response.status in [200, 201]:
            response_data = json.loads(response.data.decode('utf-8'))
            logger.info(f"Role mapping updated successfully: {response_data}")
            
            # Verify the update
            verify_response = http.request('GET', role_mapping_url, headers=headers, timeout=30)
            if verify_response.status == 200:
                updated_mapping = json.loads(verify_response.data.decode('utf-8'))
                logger.info(f"Verified role mapping: {json.dumps(updated_mapping, indent=2)}")
            
            send_response('SUCCESS', {
                'Message': 'Role mapping configured successfully',
                'FirehoseRoleArn': firehose_role_arn,
                'BackendRoles': backend_roles
            })
            
        else:
            error_msg = f"Failed to update role mapping: HTTP {response.status} - {response.data.decode('utf-8')}"
            logger.error(error_msg)
            send_response('FAILED', reason=error_msg)
            
    except Exception as e:
        error_msg = f"Error configuring OpenSearch role mapping: {str(e)}"
        logger.error(error_msg, exc_info=True)
        send_response('FAILED', reason=error_msg)
        return {'statusCode': 500, 'body': error_msg}
    
    return {'statusCode': 200}