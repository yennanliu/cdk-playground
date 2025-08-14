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
    Lambda function to manage OpenSearch indices and index templates.
    
    This handles CloudFormation custom resource events.
    """
    
    logger.info(f"Received event: {json.dumps(event, indent=2)}")
    
    try:
        request_type = event.get('RequestType', 'Create')
        resource_properties = event.get('ResourceProperties', {})
        operation = resource_properties.get('operation') or event.get('operation', 'create_templates')
        
        if request_type == 'Delete':
            logger.info("Delete operation - no cleanup needed for index templates")
            return {
                'PhysicalResourceId': f'opensearch-index-manager-{operation}',
                'Data': {'Message': 'Delete completed successfully'}
            }
        
        # Extract parameters from ResourceProperties (CloudFormation format) or direct event
        domain_endpoint = resource_properties.get('domainEndpoint') or event.get('domainEndpoint')
        master_user = resource_properties.get('masterUser', 'admin') 
        master_password = resource_properties.get('masterPassword', 'Admin@OpenSearch123!')
        
        if not domain_endpoint:
            # Try environment variables
            import os
            domain_endpoint = os.environ.get('DOMAIN_ENDPOINT')
            master_user = os.environ.get('MASTER_USER', 'admin')
            master_password = os.environ.get('MASTER_PASSWORD', 'Admin@OpenSearch123!')
        
        if not domain_endpoint:
            raise ValueError("Domain endpoint not provided")
        
        # Ensure domain endpoint starts with https://
        if not domain_endpoint.startswith('https://'):
            domain_endpoint = f"https://{domain_endpoint}"
        
        logger.info(f"Managing OpenSearch indices for domain: {domain_endpoint}")
        logger.info(f"Operation: {operation}")
        
        # Wait for domain to be ready (with retries)
        http = urllib3.PoolManager()
        credentials = f"{master_user}:{master_password}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        
        headers = {
            'Authorization': f'Basic {encoded_credentials}',
            'Content-Type': 'application/json'
        }
        
        # Test domain connectivity
        max_retries = 10
        for attempt in range(max_retries):
            try:
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
                time.sleep(30)
            else:
                raise Exception(f"Domain not ready after {max_retries} attempts")
        
        results = []
        
        if operation in ['create_templates', 'both']:
            # Create index templates for eks-control-plane and eks-pod
            results.extend(create_index_templates(http, domain_endpoint, headers))
        
        if operation in ['create_indices', 'both']:
            # Create actual indices
            results.extend(create_indices(http, domain_endpoint, headers))
        
        return {
            'PhysicalResourceId': f'opensearch-index-manager-{operation}',
            'Data': {
                'Message': f'Index management completed successfully',
                'Operation': operation,
                'Results': results,
                'body': json.dumps({
                    'Message': f'Index management completed successfully',
                    'Operation': operation,
                    'Results': results
                })
            }
        }
        
    except Exception as e:
        error_msg = f"Error managing OpenSearch indices: {str(e)}"
        logger.error(error_msg, exc_info=True)
        raise Exception(error_msg)

def create_index_templates(http: urllib3.PoolManager, domain_endpoint: str, headers: dict) -> list:
    """Create index templates for eks-control-plane and eks-pod"""
    results = []
    
    # EKS Logs Index Template
    eks_template = {
        "index_patterns": ["eks-control-plane-*"],
        "template": {
            "settings": {
                "number_of_shards": 2,
                "number_of_replicas": 1,
                "index": {
                    "refresh_interval": "30s",
                    "mapping": {
                        "total_fields": {"limit": 2000}
                    }
                }
            },
            "mappings": {
                "properties": {
                    "@timestamp": {"type": "date"},
                    "@message": {"type": "text", "analyzer": "standard"},
                    "@logGroup": {"type": "keyword"},
                    "@logStream": {"type": "keyword"},
                    "cluster_name": {"type": "keyword"},
                    "service_name": {"type": "keyword"},
                    "log_level": {"type": "keyword"},
                    "source": {"type": "keyword"},
                    "eks_cluster_name": {"type": "keyword"},
                    "aws_region": {"type": "keyword"},
                    "log_type": {"type": "keyword"}
                }
            }
        },
        "priority": 100,
        "version": 1,
        "_meta": {
            "description": "Index template for EKS control plane logs"
        }
    }
    
    # Pod Logs Index Template
    pod_template = {
        "index_patterns": ["eks-pod-*"],
        "template": {
            "settings": {
                "number_of_shards": 2,
                "number_of_replicas": 1,
                "index": {
                    "refresh_interval": "30s",
                    "mapping": {
                        "total_fields": {"limit": 2000}
                    }
                }
            },
            "mappings": {
                "properties": {
                    "@timestamp": {"type": "date"},
                    "@message": {"type": "text", "analyzer": "standard"},
                    "@logGroup": {"type": "keyword"},
                    "@logStream": {"type": "keyword"},
                    "kubernetes": {
                        "type": "object",
                        "properties": {
                            "namespace_name": {"type": "keyword"},
                            "pod_name": {"type": "keyword"},
                            "container_name": {"type": "keyword"},
                            "pod_id": {"type": "keyword"},
                            "labels": {"type": "object", "enabled": False},
                            "annotations": {"type": "object", "enabled": False}
                        }
                    },
                    "docker": {
                        "type": "object", 
                        "properties": {
                            "container_id": {"type": "keyword"}
                        }
                    },
                    "stream": {"type": "keyword"},
                    "tag": {"type": "keyword"},
                    "log": {"type": "text", "analyzer": "standard"},
                    "host": {"type": "keyword"},
                    "source": {"type": "keyword"},
                    "log_level": {"type": "keyword"},
                    "aws_region": {"type": "keyword"},
                    "log_type": {"type": "keyword"}
                }
            }
        },
        "priority": 100,
        "version": 1,
        "_meta": {
            "description": "Index template for Kubernetes pod logs"
        }
    }
    
    # Create EKS template
    eks_url = f"{domain_endpoint}/_index_template/eks-control-plane-template"
    logger.info(f"Creating EKS control plane index template...")
    
    try:
        response = http.request('PUT', eks_url, 
                               body=json.dumps(eks_template),
                               headers=headers, 
                               timeout=30)
        
        if response.status in [200, 201]:
            logger.info("EKS control plane index template created successfully")
            results.append({"template": "eks-control-plane-template", "status": "created"})
        else:
            logger.warning(f"Failed to create EKS template: {response.status} - {response.data.decode('utf-8')}")
            results.append({"template": "eks-control-plane-template", "status": "failed", "error": response.data.decode('utf-8')})
            
    except Exception as e:
        logger.error(f"Error creating EKS template: {str(e)}")
        results.append({"template": "eks-control-plane-template", "status": "error", "error": str(e)})
    
    # Create Pod template
    pod_url = f"{domain_endpoint}/_index_template/eks-pod-template"
    logger.info(f"Creating EKS pod logs index template...")
    
    try:
        response = http.request('PUT', pod_url, 
                               body=json.dumps(pod_template),
                               headers=headers, 
                               timeout=30)
        
        if response.status in [200, 201]:
            logger.info("EKS pod logs index template created successfully")
            results.append({"template": "eks-pod-template", "status": "created"})
        else:
            logger.warning(f"Failed to create Pod template: {response.status} - {response.data.decode('utf-8')}")
            results.append({"template": "eks-pod-template", "status": "failed", "error": response.data.decode('utf-8')})
            
    except Exception as e:
        logger.error(f"Error creating Pod template: {str(e)}")
        results.append({"template": "eks-pod-template", "status": "error", "error": str(e)})
    
    return results

def create_indices(http: urllib3.PoolManager, domain_endpoint: str, headers: dict) -> list:
    """Create actual indices for eks-control-plane and eks-pod"""
    results = []
    
    # Generate index names with current date
    from datetime import datetime
    current_date = datetime.now().strftime('%Y.%m.%d')
    
    eks_index_name = f"eks-control-plane-{current_date}"
    pod_index_name = f"eks-pod-{current_date}"
    
    # Check if indices already exist
    for index_name, log_type in [(eks_index_name, "eks"), (pod_index_name, "pod")]:
        try:
            check_url = f"{domain_endpoint}/{index_name}"
            response = http.request('HEAD', check_url, headers=headers, timeout=30)
            
            if response.status == 200:
                logger.info(f"Index {index_name} already exists")
                results.append({"index": index_name, "status": "exists"})
                continue
                
            # Create the index
            logger.info(f"Creating {log_type} logs index: {index_name}")
            create_url = f"{domain_endpoint}/{index_name}"
            
            # Let the index template handle the mapping
            index_config = {
                "settings": {
                    "index": {
                        "number_of_shards": 2,
                        "number_of_replicas": 1
                    }
                }
            }
            
            response = http.request('PUT', create_url, 
                                   body=json.dumps(index_config),
                                   headers=headers, 
                                   timeout=30)
            
            if response.status in [200, 201]:
                logger.info(f"Index {index_name} created successfully")
                results.append({"index": index_name, "status": "created"})
            else:
                logger.warning(f"Failed to create index {index_name}: {response.status} - {response.data.decode('utf-8')}")
                results.append({"index": index_name, "status": "failed", "error": response.data.decode('utf-8')})
                
        except Exception as e:
            logger.error(f"Error managing index {index_name}: {str(e)}")
            results.append({"index": index_name, "status": "error", "error": str(e)})
    
    return results