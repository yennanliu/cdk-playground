import json
import boto3
import os
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
logs_client = boto3.client('logs')
dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')

# Environment variables
SERVICE_REGISTRY_TABLE = os.environ['SERVICE_REGISTRY_TABLE']
ONBOARDING_QUEUE_URL = os.environ['ONBOARDING_QUEUE_URL']
STAGE = os.environ['STAGE']
OPENSEARCH_DOMAIN = os.environ['OPENSEARCH_DOMAIN']

# Service registry table
table = dynamodb.Table(SERVICE_REGISTRY_TABLE)

# Service detection patterns
SERVICE_PATTERNS = {
    'eks': {
        'patterns': [r'/aws/eks/.*/cluster$', r'/aws/eks/.*/application$'],
        'type': 'kubernetes',
        'auto_onboard': True
    },
    'rds': {
        'patterns': [r'/aws/rds/instance/.*/error$', r'/aws/rds/instance/.*/slowquery$'],
        'type': 'database',
        'auto_onboard': False  # Requires approval
    },
    'lambda': {
        'patterns': [r'/aws/lambda/.*'],
        'type': 'serverless',
        'auto_onboard': True
    },
    'apigateway': {
        'patterns': [r'/aws/apigateway/.*'],
        'type': 'api',
        'auto_onboard': True
    },
    'ecs': {
        'patterns': [r'/ecs/.*', r'/aws/ecs/containerinsights/.*/.*'],
        'type': 'container',
        'auto_onboard': True
    },
    'kafka': {
        'patterns': [r'.*kafka.*', r'.*msk.*'],
        'type': 'messaging',
        'auto_onboard': False  # Requires approval
    },
    'application': {
        'patterns': [r'/application/.*', r'/app/.*'],
        'type': 'application',
        'auto_onboard': False  # Requires approval
    }
}

def handler(event, context):
    """
    Main handler for service discovery Lambda function.
    """
    try:
        logger.info(f"Received event: {json.dumps(event, default=str)}")
        
        # Handle different event sources
        if 'source' in event and event['source'] == 'periodic-scan':
            return handle_periodic_scan(event)
        elif 'detail' in event and event['detail'].get('eventSource') == 'logs.amazonaws.com':
            return handle_cloudtrail_event(event)
        else:
            return handle_direct_invocation(event)
            
    except Exception as e:
        logger.error(f"Error in service discovery: {str(e)}")
        raise

def handle_periodic_scan(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle periodic full scan of log groups.
    """
    logger.info("Starting periodic service discovery scan")
    
    discovered_services = []
    paginator = logs_client.get_paginator('describe_log_groups')
    
    for page in paginator.paginate():
        for log_group in page['logGroups']:
            log_group_name = log_group['logGroupName']
            service_info = detect_service_type(log_group_name, log_group)
            
            if service_info:
                discovered_services.append(service_info)
                process_discovered_service(service_info)
    
    logger.info(f"Discovered {len(discovered_services)} services")
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'discovered_services': len(discovered_services),
            'services': discovered_services
        })
    }

def handle_cloudtrail_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle CloudTrail event for new log group creation.
    """
    detail = event['detail']
    
    # Check if requestParameters exists and contains logGroupName
    if not detail.get('requestParameters') or not detail['requestParameters'].get('logGroupName'):
        logger.warning("CloudTrail event has no requestParameters or logGroupName - likely a failed API call")
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Skipped CloudTrail event with missing requestParameters'
            })
        }
    
    log_group_name = detail['requestParameters']['logGroupName']
    
    logger.info(f"Processing new log group: {log_group_name}")
    
    # Get log group details
    try:
        response = logs_client.describe_log_groups(
            logGroupNamePrefix=log_group_name,
            limit=1
        )
        
        if response['logGroups']:
            log_group = response['logGroups'][0]
            service_info = detect_service_type(log_group_name, log_group)
            
            if service_info:
                process_discovered_service(service_info)
                return {
                    'statusCode': 200,
                    'body': json.dumps({
                        'message': f'Service detected and processed: {service_info["service_name"]}'
                    })
                }
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': f'Log group processed but no service pattern matched: {log_group_name}'
            })
        }
        
    except Exception as e:
        logger.error(f"Error processing log group {log_group_name}: {str(e)}")
        raise

def handle_direct_invocation(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle direct invocation with specific log group or service info.
    """
    if 'logGroupName' in event:
        log_group_name = event['logGroupName']
        service_info = detect_service_type(log_group_name)
        
        if service_info:
            process_discovered_service(service_info)
            return {
                'statusCode': 200,
                'body': json.dumps(service_info)
            }
    
    return {
        'statusCode': 400,
        'body': json.dumps({
            'error': 'Invalid event format'
        })
    }

def detect_service_type(log_group_name: str, log_group_details: Optional[Dict] = None) -> Optional[Dict[str, Any]]:
    """
    Detect service type based on log group name patterns.
    """
    for service_type, config in SERVICE_PATTERNS.items():
        for pattern in config['patterns']:
            if re.match(pattern, log_group_name, re.IGNORECASE):
                # Extract service name from log group name
                service_name = extract_service_name(log_group_name, service_type)
                
                # Check if subscription filter already exists
                has_subscription = check_existing_subscription(log_group_name)
                
                service_info = {
                    'service_name': service_name,
                    'service_type': service_type,
                    'category': config['type'],
                    'log_group_name': log_group_name,
                    'auto_onboard': config['auto_onboard'],
                    'has_existing_subscription': has_subscription,
                    'discovered_at': datetime.now(timezone.utc).isoformat(),
                    'environment': STAGE,
                    'opensearch_domain': OPENSEARCH_DOMAIN
                }
                
                # Add additional metadata if log group details are available
                if log_group_details:
                    service_info.update({
                        'creation_time': log_group_details.get('creationTime', 0),
                        'stored_bytes': log_group_details.get('storedBytes', 0),
                        'retention_days': log_group_details.get('retentionInDays')
                    })
                
                logger.info(f"Detected service: {service_info}")
                return service_info
    
    return None

def extract_service_name(log_group_name: str, service_type: str) -> str:
    """
    Extract a meaningful service name from log group name.
    """
    # Clean up the log group name to create a service name
    name = log_group_name.replace('/', '').replace('-', '_')
    
    # Service-specific name extraction
    if service_type == 'eks':
        # Extract cluster name from EKS log groups
        match = re.search(r'/aws/eks/([^/]+)', log_group_name)
        if match:
            return f"eks_{match.group(1).replace('-', '_')}"
    elif service_type == 'lambda':
        # Extract function name from Lambda log groups
        match = re.search(r'/aws/lambda/([^/]+)', log_group_name)
        if match:
            return f"lambda_{match.group(1).replace('-', '_')}"
    elif service_type == 'rds':
        # Extract instance name from RDS log groups
        match = re.search(r'/aws/rds/instance/([^/]+)', log_group_name)
        if match:
            return f"rds_{match.group(1).replace('-', '_')}"
    
    # Generic cleanup for other service types
    name = re.sub(r'[^a-zA-Z0-9_]', '_', name)
    name = re.sub(r'_+', '_', name)  # Remove multiple underscores
    name = name.strip('_')  # Remove leading/trailing underscores
    
    return f"{service_type}_{name}" if name else service_type

def check_existing_subscription(log_group_name: str) -> bool:
    """
    Check if log group already has a subscription filter.
    """
    try:
        response = logs_client.describe_subscription_filters(
            logGroupName=log_group_name
        )
        return len(response['subscriptionFilters']) > 0
    except Exception as e:
        logger.warning(f"Error checking subscription filters for {log_group_name}: {str(e)}")
        return False

def process_discovered_service(service_info: Dict[str, Any]) -> None:
    """
    Process a discovered service by updating registry and triggering onboarding if needed.
    """
    service_name = service_info['service_name']
    environment = service_info['environment']
    
    # Check if service already exists in registry
    try:
        response = table.get_item(
            Key={
                'serviceName': service_name,
                'environment': environment
            }
        )
        
        if 'Item' in response:
            existing_item = response['Item']
            logger.info(f"Service {service_name} already exists in registry with status: {existing_item.get('status')}")
            
            # Update last seen timestamp
            table.update_item(
                Key={
                    'serviceName': service_name,
                    'environment': environment
                },
                UpdateExpression='SET lastSeen = :timestamp',
                ExpressionAttributeValues={
                    ':timestamp': service_info['discovered_at']
                }
            )
            return
            
    except Exception as e:
        logger.error(f"Error checking existing service {service_name}: {str(e)}")
    
    # Add new service to registry
    service_record = {
        'serviceName': service_name,
        'environment': environment,
        'serviceType': service_info['service_type'],
        'category': service_info['category'],
        'logGroupName': service_info['log_group_name'],
        'autoOnboard': service_info['auto_onboard'],
        'hasExistingSubscription': service_info['has_existing_subscription'],
        'status': 'discovered',
        'discoveredAt': service_info['discovered_at'],
        'lastSeen': service_info['discovered_at'],
        'lastUpdated': service_info['discovered_at'],
        'opensearchDomain': service_info['opensearch_domain']
    }
    
    # Add optional fields
    for field in ['creation_time', 'stored_bytes', 'retention_days']:
        if field in service_info:
            service_record[field] = service_info[field]
    
    try:
        table.put_item(Item=service_record)
        logger.info(f"Added service {service_name} to registry")
        
        # Trigger onboarding workflow if conditions are met
        if should_trigger_onboarding(service_info):
            trigger_onboarding(service_info)
            
    except Exception as e:
        logger.error(f"Error adding service {service_name} to registry: {str(e)}")
        raise

def should_trigger_onboarding(service_info: Dict[str, Any]) -> bool:
    """
    Determine if onboarding should be automatically triggered.
    """
    return (
        service_info['auto_onboard'] and 
        not service_info['has_existing_subscription']
    )

def trigger_onboarding(service_info: Dict[str, Any]) -> None:
    """
    Send service info to onboarding queue.
    """
    message = {
        'action': 'onboard_service',
        'service_info': service_info,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    
    try:
        sqs.send_message(
            QueueUrl=ONBOARDING_QUEUE_URL,
            MessageBody=json.dumps(message, default=str),
            MessageAttributes={
                'action': {
                    'StringValue': 'onboard_service',
                    'DataType': 'String'
                },
                'service_name': {
                    'StringValue': service_info['service_name'],
                    'DataType': 'String'
                }
            }
        )
        
        logger.info(f"Triggered onboarding for service: {service_info['service_name']}")
        
        # Update service status in registry
        table.update_item(
            Key={
                'serviceName': service_info['service_name'],
                'environment': service_info['environment']
            },
            UpdateExpression='SET #status = :status, lastUpdated = :timestamp',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':status': 'onboarding_queued',
                ':timestamp': datetime.now(timezone.utc).isoformat()
            }
        )
        
    except Exception as e:
        logger.error(f"Error triggering onboarding for {service_info['service_name']}: {str(e)}")
        raise