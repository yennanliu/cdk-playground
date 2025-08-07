import json
import boto3
import requests
from requests.auth import HTTPBasicAuth
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Lambda function to manually create OpenSearch indices for debugging
    """
    
    try:
        # Get OpenSearch endpoint from environment
        domain_endpoint = os.environ.get('DOMAIN_ENDPOINT')
        master_user = os.environ.get('MASTER_USER', 'admin')
        master_password = os.environ.get('MASTER_PASSWORD', 'Admin@OpenSearch123!')
        
        if not domain_endpoint:
            return {
                'statusCode': 400,
                'body': json.dumps('DOMAIN_ENDPOINT environment variable not set')
            }
        
        # Ensure https:// prefix
        if not domain_endpoint.startswith('https://'):
            domain_endpoint = f'https://{domain_endpoint}'
        
        # Define indices to create manually (for debugging)
        # Note: With proper index templates, these should auto-create
        indices_to_create = {
            'eks-logs': {
                "mappings": {
                    "properties": {
                        "@timestamp": {"type": "date"},
                        "log_level": {"type": "keyword"},
                        "message": {"type": "text"},
                        "eks.cluster_name": {"type": "keyword"},
                        "eks.service_name": {"type": "keyword"},
                        "eks.log_group": {"type": "keyword"},
                        "eks.log_stream": {"type": "keyword"},
                        "aws.region": {"type": "keyword"},
                        "source": {"type": "keyword"},
                        "raw_message": {"type": "text"}
                    }
                },
                "settings": {
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                    "index.auto_expand_replicas": "0-1"
                }
            },
            'pod-logs': {
                "mappings": {
                    "properties": {
                        "@timestamp": {"type": "date"},
                        "timestamp": {"type": "date"},
                        "message": {"type": "text"},
                        "pod_name": {"type": "keyword"},
                        "namespace": {"type": "keyword"},
                        "container_name": {"type": "keyword"},
                        "cluster": {"type": "keyword"},
                        "log_type": {"type": "keyword"},
                        "log_group": {"type": "keyword"},
                        "log_stream": {"type": "keyword"}
                    }
                },
                "settings": {
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                    "index.auto_expand_replicas": "0-1"
                }
            }
        }
        
        results = []
        auth = HTTPBasicAuth(master_user, master_password)
        
        for index_name, index_config in indices_to_create.items():
            try:
                # Check if index exists
                check_url = f'{domain_endpoint}/{index_name}'
                check_response = requests.head(check_url, auth=auth, timeout=30)
                
                if check_response.status_code == 200:
                    logger.info(f'Index {index_name} already exists')
                    results.append(f'Index {index_name} already exists')
                    continue
                
                # Create index
                create_url = f'{domain_endpoint}/{index_name}'
                create_response = requests.put(
                    create_url,
                    auth=auth,
                    headers={'Content-Type': 'application/json'},
                    data=json.dumps(index_config),
                    timeout=30
                )
                
                if create_response.status_code in [200, 201]:
                    logger.info(f'Successfully created index {index_name}')
                    results.append(f'Successfully created index {index_name}')
                else:
                    logger.error(f'Failed to create index {index_name}: {create_response.status_code} - {create_response.text}')
                    results.append(f'Failed to create index {index_name}: {create_response.status_code} - {create_response.text}')
                
            except Exception as e:
                logger.error(f'Error processing index {index_name}: {str(e)}')
                results.append(f'Error processing index {index_name}: {str(e)}')
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Index creation process completed',
                'results': results
            })
        }
        
    except Exception as e:
        logger.error(f'Error in lambda_handler: {str(e)}')
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }