import json
import urllib3
import base64
import time
import logging
import os
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Disable SSL warnings for self-signed certificates (if needed)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Lambda function to manage OpenSearch indices and templates.
    
    Supports two operations based on event payload:
    1. Create index templates (auto-creation for Firehose)
    2. Create indices manually (debugging/testing)
    
    Expected event payload:
    {
        "operation": "create_templates|create_indices",
        "domainEndpoint": "https://search-domain-name.region.es.amazonaws.com",
        "masterUser": "admin",
        "masterPassword": "password",
        "RequestType": "Create|Update|Delete"  # For CloudFormation custom resources
    }
    """
    
    logger.info(f"Received event: {json.dumps(event, indent=2)}")
    
    try:
        request_type = event.get('RequestType', 'Create')
        operation = event.get('operation', 'create_templates')
        
        if request_type == 'Delete':
            # For delete operations, we'll just return success
            # Index templates and indices don't need to be cleaned up
            logger.info("Delete operation - no cleanup needed for indices/templates")
            return {
                'statusCode': 200,
                'body': json.dumps({'Message': 'Delete completed successfully'})
            }
        
        # Extract parameters
        domain_endpoint = event.get('domainEndpoint') or os.environ.get('DOMAIN_ENDPOINT')
        master_user = event.get('masterUser', os.environ.get('MASTER_USER', 'admin'))
        master_password = event.get('masterPassword', os.environ.get('MASTER_PASSWORD', 'Admin@OpenSearch123!'))
        
        if not domain_endpoint:
            return {
                'statusCode': 400,
                'body': json.dumps('domainEndpoint not provided in event or DOMAIN_ENDPOINT environment variable')
            }
        
        # Ensure domain endpoint starts with https://
        if not domain_endpoint.startswith('https://'):
            domain_endpoint = f"https://{domain_endpoint}"
        
        logger.info(f"Managing indices for domain: {domain_endpoint}")
        logger.info(f"Operation: {operation}")
        
        # Wait for domain to be ready (with retries)
        http = wait_for_domain_ready(domain_endpoint, master_user, master_password)
        
        # Create auth headers
        credentials = f"{master_user}:{master_password}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        headers = {
            'Authorization': f'Basic {encoded_credentials}',
            'Content-Type': 'application/json'
        }
        
        # Execute operation
        if operation == 'create_templates':
            results = create_index_templates(http, domain_endpoint, headers)
            message = 'Index templates configured successfully'
        elif operation == 'create_indices':
            results = create_indices_manually(http, domain_endpoint, headers)
            message = 'Indices created successfully'
        else:
            raise ValueError(f"Unknown operation: {operation}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'Message': message,
                'Operation': operation,
                'Results': results
            })
        }
        
    except Exception as e:
        error_msg = f"Error managing OpenSearch indices: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({'Error': error_msg})
        }


def wait_for_domain_ready(domain_endpoint: str, master_user: str, master_password: str):
    """
    Wait for OpenSearch domain to be ready with retries
    """
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
                return http
            else:
                logger.warning(f"Domain not ready yet (attempt {attempt + 1}): status {response.status}")
                
        except Exception as e:
            logger.warning(f"Domain connectivity test failed (attempt {attempt + 1}): {str(e)}")
        
        if attempt < max_retries - 1:
            time.sleep(30)  # Wait 30 seconds between retries
        else:
            raise Exception(f"Domain not ready after {max_retries} attempts")


def get_index_definitions():
    """
    Centralized index mappings and settings definitions
    """
    return {
        'eks-logs': {
            'mappings': {
                'properties': {
                    '@timestamp': {'type': 'date'},
                    'log_level': {'type': 'keyword'},
                    'message': {'type': 'text'},
                    'eks': {
                        'properties': {
                            'cluster_name': {'type': 'keyword'},
                            'service_name': {'type': 'keyword'},
                            'log_group': {'type': 'keyword'},
                            'log_stream': {'type': 'keyword'}
                        }
                    },
                    'aws': {
                        'properties': {
                            'region': {'type': 'keyword'},
                            'log_group': {'type': 'keyword'},
                            'log_stream': {'type': 'keyword'}
                        }
                    },
                    'source': {'type': 'keyword'},
                    'raw_message': {'type': 'text'}
                }
            },
            'settings': {
                'number_of_shards': 1,
                'number_of_replicas': 0,
                'index.auto_expand_replicas': '0-1'
            }
        },
        'pod-logs': {
            'mappings': {
                'properties': {
                    '@timestamp': {'type': 'date'},
                    'timestamp': {'type': 'date'},
                    'message': {'type': 'text'},
                    'pod_name': {'type': 'keyword'},
                    'namespace': {'type': 'keyword'},
                    'container_name': {'type': 'keyword'},
                    'cluster': {'type': 'keyword'},
                    'log_type': {'type': 'keyword'},
                    'log_group': {'type': 'keyword'},
                    'log_stream': {'type': 'keyword'},
                    'stream': {'type': 'keyword'},
                    'logtag': {'type': 'keyword'},
                    'host': {'type': 'keyword'},
                    'pod_id': {'type': 'keyword'},
                    'labels': {'type': 'object'},
                    'docker_id': {'type': 'keyword'},
                    'container_hash': {'type': 'keyword'},
                    'container_image': {'type': 'keyword'}
                }
            },
            'settings': {
                'number_of_shards': 1,
                'number_of_replicas': 0,
                'index.auto_expand_replicas': '0-1'
            }
        }
    }


def create_index_templates(http, domain_endpoint: str, headers: Dict[str, str]) -> Dict[str, str]:
    """
    Create index templates for eks-logs and pod-logs to enable auto-creation
    """
    results = {}
    index_definitions = get_index_definitions()
    
    # Convert index definitions to template format
    templates = {}
    for index_name, index_config in index_definitions.items():
        templates[f'{index_name}-template'] = {
            'index_patterns': [f'{index_name}*'],
            'template': index_config
        }
    
    for template_name, template_config in templates.items():
        try:
            template_url = f"{domain_endpoint}/_index_template/{template_name}"
            
            logger.info(f"Creating index template: {template_name}")
            response = http.request('PUT', template_url, 
                                   body=json.dumps(template_config),
                                   headers=headers, 
                                   timeout=30)
            
            if response.status in [200, 201]:
                logger.info(f"Index template {template_name} created successfully")
                results[template_name] = 'success'
            else:
                error_msg = f"Failed to create index template {template_name}: {response.status} - {response.data.decode('utf-8')}"
                logger.error(error_msg)
                results[template_name] = f'failed: {response.status}'
                
        except Exception as e:
            logger.error(f"Error creating index template {template_name}: {str(e)}")
            results[template_name] = f'error: {str(e)}'
    
    return results


def create_indices_manually(http, domain_endpoint: str, headers: Dict[str, str]) -> Dict[str, str]:
    """
    Create indices manually (for debugging/testing purposes)
    """
    results = {}
    index_definitions = get_index_definitions()
    
    for index_name, index_config in index_definitions.items():
        try:
            # Check if index exists
            check_url = f'{domain_endpoint}/{index_name}'
            check_response = http.request('HEAD', check_url, headers=headers, timeout=30)
            
            if check_response.status == 200:
                logger.info(f'Index {index_name} already exists')
                results[index_name] = 'already_exists'
                continue
            
            # Create index
            create_url = f'{domain_endpoint}/{index_name}'
            create_response = http.request('PUT', create_url,
                                         body=json.dumps(index_config),
                                         headers=headers,
                                         timeout=30)
            
            if create_response.status in [200, 201]:
                logger.info(f'Successfully created index {index_name}')
                results[index_name] = 'created'
            else:
                error_msg = f'Failed to create index {index_name}: {create_response.status} - {create_response.data.decode("utf-8")}'
                logger.error(error_msg)
                results[index_name] = f'failed: {create_response.status}'
            
        except Exception as e:
            logger.error(f'Error processing index {index_name}: {str(e)}')
            results[index_name] = f'error: {str(e)}'
    
    return results