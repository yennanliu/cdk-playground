import json
import boto3
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
import logging
import re

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')
ssm = boto3.client('ssm')
logs_client = boto3.client('logs')

# Environment variables
SERVICE_REGISTRY_TABLE = os.environ['SERVICE_REGISTRY_TABLE']
ONBOARDING_QUEUE_URL = os.environ['ONBOARDING_QUEUE_URL']
STAGE = os.environ['STAGE']
OPENSEARCH_DOMAIN = os.environ['OPENSEARCH_DOMAIN']

# Service registry table
table = dynamodb.Table(SERVICE_REGISTRY_TABLE)

def handler(event, context):
    """
    Main handler for service management API.
    """
    try:
        logger.info(f"Received event: {json.dumps(event, default=str)}")
        
        http_method = event['httpMethod']
        path = event['path']
        path_parameters = event.get('pathParameters') or {}
        query_parameters = event.get('queryStringParameters') or {}
        body = event.get('body')
        
        # Parse request body if present
        request_data = None
        if body:
            try:
                request_data = json.loads(body)
            except json.JSONDecodeError:
                return error_response(400, "Invalid JSON in request body")
        
        # Route requests
        if path == '/services':
            if http_method == 'GET':
                return list_services(query_parameters)
            elif http_method == 'POST':
                return create_service(request_data)
        
        elif path.startswith('/services/') and path.count('/') == 2:
            service_name = path_parameters.get('serviceName')
            if not service_name:
                return error_response(400, "Service name is required")
            
            if http_method == 'GET':
                return get_service(service_name)
            elif http_method == 'PUT':
                return update_service(service_name, request_data)
            elif http_method == 'DELETE':
                return delete_service(service_name)
        
        elif path.endswith('/actions/onboard'):
            service_name = path_parameters.get('serviceName')
            if http_method == 'POST':
                return trigger_onboarding(service_name, request_data)
        
        elif path.endswith('/actions/approve'):
            service_name = path_parameters.get('serviceName')
            if http_method == 'POST':
                return approve_service(service_name, request_data)
        
        elif path.endswith('/actions/reject'):
            service_name = path_parameters.get('serviceName')
            if http_method == 'POST':
                return reject_service(service_name, request_data)
        
        elif path == '/templates':
            if http_method == 'GET':
                return list_templates()
        
        elif path.startswith('/templates/'):
            template_name = path_parameters.get('templateName')
            if http_method == 'GET':
                return get_template(template_name)
        
        elif path == '/health':
            if http_method == 'GET':
                return health_check()
        
        return error_response(404, "Endpoint not found")
        
    except Exception as e:
        logger.error(f"Error in API handler: {str(e)}")
        return error_response(500, "Internal server error")

def success_response(data: Any, status_code: int = 200) -> Dict[str, Any]:
    """
    Create a successful API response.
    """
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key'
        },
        'body': json.dumps(data, default=str)
    }

def error_response(status_code: int, message: str) -> Dict[str, Any]:
    """
    Create an error API response.
    """
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key'
        },
        'body': json.dumps({
            'error': message,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
    }

def list_services(query_parameters: Dict[str, str]) -> Dict[str, Any]:
    """
    List all services in the registry with optional filtering.
    """
    try:
        status_filter = query_parameters.get('status')
        environment_filter = query_parameters.get('environment', STAGE)
        
        if status_filter:
            # Query by status using GSI
            response = table.query(
                IndexName='StatusIndex',
                KeyConditionExpression='#status = :status',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':status': status_filter}
            )
            services = response['Items']
            
            # Filter by environment if specified
            if environment_filter:
                services = [s for s in services if s.get('environment') == environment_filter]
        else:
            # Scan all services (less efficient for large datasets)
            response = table.scan()
            services = response['Items']
            
            # Filter by environment if specified
            if environment_filter:
                services = [s for s in services if s.get('environment') == environment_filter]
        
        # Convert DynamoDB items to regular dicts
        services = [{k: v for k, v in service.items()} for service in services]
        
        return success_response({
            'services': services,
            'count': len(services),
            'filters': {
                'status': status_filter,
                'environment': environment_filter
            }
        })
        
    except Exception as e:
        logger.error(f"Error listing services: {str(e)}")
        return error_response(500, f"Error listing services: {str(e)}")

def create_service(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new service registration.
    """
    try:
        # Validate required fields
        required_fields = ['serviceName', 'serviceType', 'logGroupName']
        for field in required_fields:
            if not request_data.get(field):
                return error_response(400, f"Missing required field: {field}")
        
        service_name = request_data['serviceName']
        service_type = request_data['serviceType']
        log_group_name = request_data['logGroupName']
        
        # Validate service name format
        if not re.match(r'^[a-zA-Z][a-zA-Z0-9_-]*$', service_name):
            return error_response(400, "Service name must start with a letter and contain only letters, numbers, hyphens, and underscores")
        
        # Validate log group name
        if not log_group_name.startswith('/'):
            return error_response(400, "Log group name must start with '/'")
        
        # Check if service already exists
        try:
            response = table.get_item(
                Key={
                    'serviceName': service_name,
                    'environment': STAGE
                }
            )
            
            if 'Item' in response:
                return error_response(409, f"Service {service_name} already exists")
                
        except Exception as e:
            logger.warning(f"Error checking existing service: {str(e)}")
        
        # Verify log group exists
        if not verify_log_group_exists(log_group_name):
            return error_response(400, f"Log group {log_group_name} does not exist")
        
        # Create service record
        service_record = {
            'serviceName': service_name,
            'environment': STAGE,
            'serviceType': service_type,
            'logGroupName': log_group_name,
            'indexName': request_data.get('indexName', f"{service_name}-logs"),
            'processorType': request_data.get('processorType', service_type),
            'autoOnboard': request_data.get('autoOnboard', False),
            'status': 'registered',
            'createdAt': datetime.now(timezone.utc).isoformat(),
            'lastUpdated': datetime.now(timezone.utc).isoformat(),
            'opensearchDomain': OPENSEARCH_DOMAIN
        }
        
        # Add custom configuration if provided
        if request_data.get('customConfig'):
            service_record['customConfig'] = request_data['customConfig']
        
        # Save to registry
        table.put_item(Item=service_record)
        
        # Trigger onboarding if auto-onboard is enabled
        if request_data.get('autoOnboard', False):
            trigger_service_onboarding(service_record)
            service_record['status'] = 'onboarding_queued'
            
            # Update status in registry
            table.update_item(
                Key={
                    'serviceName': service_name,
                    'environment': STAGE
                },
                UpdateExpression='SET #status = :status, lastUpdated = :timestamp',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': 'onboarding_queued',
                    ':timestamp': datetime.now(timezone.utc).isoformat()
                }
            )
        
        logger.info(f"Created service registration: {service_name}")
        
        return success_response({
            'message': f"Service {service_name} registered successfully",
            'service': service_record
        }, 201)
        
    except Exception as e:
        logger.error(f"Error creating service: {str(e)}")
        return error_response(500, f"Error creating service: {str(e)}")

def get_service(service_name: str) -> Dict[str, Any]:
    """
    Get details of a specific service.
    """
    try:
        response = table.get_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            }
        )
        
        if 'Item' not in response:
            return error_response(404, f"Service {service_name} not found")
        
        service = {k: v for k, v in response['Item'].items()}
        
        return success_response({
            'service': service
        })
        
    except Exception as e:
        logger.error(f"Error getting service {service_name}: {str(e)}")
        return error_response(500, f"Error getting service: {str(e)}")

def update_service(service_name: str, request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update service configuration.
    """
    try:
        # Check if service exists
        response = table.get_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            }
        )
        
        if 'Item' not in response:
            return error_response(404, f"Service {service_name} not found")
        
        # Build update expression
        update_expression = 'SET lastUpdated = :timestamp'
        expression_values = {':timestamp': datetime.now(timezone.utc).isoformat()}
        
        # Update allowed fields
        updatable_fields = ['indexName', 'processorType', 'autoOnboard', 'customConfig']
        
        for field in updatable_fields:
            if field in request_data:
                update_expression += f', {field} = :{field}'
                expression_values[f':{field}'] = request_data[field]
        
        # Perform update
        table.update_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            },
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values
        )
        
        logger.info(f"Updated service: {service_name}")
        
        return success_response({
            'message': f"Service {service_name} updated successfully"
        })
        
    except Exception as e:
        logger.error(f"Error updating service {service_name}: {str(e)}")
        return error_response(500, f"Error updating service: {str(e)}")

def delete_service(service_name: str) -> Dict[str, Any]:
    """
    Delete a service registration.
    """
    try:
        # Check if service exists
        response = table.get_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            }
        )
        
        if 'Item' not in response:
            return error_response(404, f"Service {service_name} not found")
        
        service = response['Item']
        
        # Check if service is currently onboarded
        if service.get('status') in ['onboarded', 'onboarding_in_progress']:
            return error_response(400, f"Cannot delete service {service_name} while it's onboarded or being onboarded")
        
        # Delete service
        table.delete_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            }
        )
        
        logger.info(f"Deleted service: {service_name}")
        
        return success_response({
            'message': f"Service {service_name} deleted successfully"
        })
        
    except Exception as e:
        logger.error(f"Error deleting service {service_name}: {str(e)}")
        return error_response(500, f"Error deleting service: {str(e)}")

def trigger_onboarding(service_name: str, request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Manually trigger onboarding for a service.
    """
    try:
        # Get service details
        response = table.get_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            }
        )
        
        if 'Item' not in response:
            return error_response(404, f"Service {service_name} not found")
        
        service = response['Item']
        
        # Check if service can be onboarded
        if service.get('status') in ['onboarding_in_progress', 'onboarded']:
            return error_response(400, f"Service {service_name} is already onboarded or being onboarded")
        
        # Trigger onboarding
        trigger_service_onboarding(service)
        
        # Update status
        table.update_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            },
            UpdateExpression='SET #status = :status, lastUpdated = :timestamp',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'onboarding_queued',
                ':timestamp': datetime.now(timezone.utc).isoformat()
            }
        )
        
        return success_response({
            'message': f"Onboarding triggered for service {service_name}"
        })
        
    except Exception as e:
        logger.error(f"Error triggering onboarding for {service_name}: {str(e)}")
        return error_response(500, f"Error triggering onboarding: {str(e)}")

def approve_service(service_name: str, request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Approve a service for onboarding.
    """
    try:
        # Update service status to approved
        table.update_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            },
            UpdateExpression='SET #status = :status, lastUpdated = :timestamp, approvedBy = :approver',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'approved',
                ':timestamp': datetime.now(timezone.utc).isoformat(),
                ':approver': request_data.get('approvedBy', 'api-user')
            }
        )
        
        return success_response({
            'message': f"Service {service_name} approved for onboarding"
        })
        
    except Exception as e:
        logger.error(f"Error approving service {service_name}: {str(e)}")
        return error_response(500, f"Error approving service: {str(e)}")

def reject_service(service_name: str, request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Reject a service for onboarding.
    """
    try:
        reason = request_data.get('reason', 'No reason provided')
        
        # Update service status to rejected
        table.update_item(
            Key={
                'serviceName': service_name,
                'environment': STAGE
            },
            UpdateExpression='SET #status = :status, lastUpdated = :timestamp, rejectionReason = :reason',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'rejected',
                ':timestamp': datetime.now(timezone.utc).isoformat(),
                ':reason': reason
            }
        )
        
        return success_response({
            'message': f"Service {service_name} rejected",
            'reason': reason
        })
        
    except Exception as e:
        logger.error(f"Error rejecting service {service_name}: {str(e)}")
        return error_response(500, f"Error rejecting service: {str(e)}")

def list_templates() -> Dict[str, Any]:
    """
    List available service templates.
    """
    try:
        # Get all template parameters
        response = ssm.get_parameters_by_path(
            Path=f"/opensearch/{STAGE}/templates/",
            Recursive=True
        )
        
        templates = []
        for param in response['Parameters']:
            template_name = param['Name'].split('/')[-1]
            template_config = json.loads(param['Value'])
            
            templates.append({
                'name': template_name,
                'description': template_config.get('description', f"Template for {template_name} services"),
                'indexName': template_config.get('indexName'),
                'processorType': template_config.get('processorType'),
                'lastModified': param['LastModifiedDate']
            })
        
        return success_response({
            'templates': templates,
            'count': len(templates)
        })
        
    except Exception as e:
        logger.error(f"Error listing templates: {str(e)}")
        return error_response(500, f"Error listing templates: {str(e)}")

def get_template(template_name: str) -> Dict[str, Any]:
    """
    Get a specific service template.
    """
    try:
        response = ssm.get_parameter(
            Name=f"/opensearch/{STAGE}/templates/{template_name}"
        )
        
        template_config = json.loads(response['Parameter']['Value'])
        
        return success_response({
            'template': {
                'name': template_name,
                'config': template_config,
                'lastModified': response['Parameter']['LastModifiedDate']
            }
        })
        
    except ssm.exceptions.ParameterNotFound:
        return error_response(404, f"Template {template_name} not found")
    except Exception as e:
        logger.error(f"Error getting template {template_name}: {str(e)}")
        return error_response(500, f"Error getting template: {str(e)}")

def health_check() -> Dict[str, Any]:
    """
    Health check endpoint.
    """
    try:
        # Check DynamoDB table
        table.describe_table()
        
        # Check SSM parameter access
        ssm.get_parameters_by_path(
            Path=f"/opensearch/{STAGE}/templates/",
            MaxItems=1
        )
        
        return success_response({
            'status': 'healthy',
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'version': '1.0.0',
            'stage': STAGE,
            'opensearch_domain': OPENSEARCH_DOMAIN
        })
        
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return error_response(503, f"Health check failed: {str(e)}")

def verify_log_group_exists(log_group_name: str) -> bool:
    """
    Verify that a CloudWatch log group exists.
    """
    try:
        logs_client.describe_log_groups(
            logGroupNamePrefix=log_group_name,
            limit=1
        )
        return True
    except Exception as e:
        logger.warning(f"Log group {log_group_name} verification failed: {str(e)}")
        return False

def trigger_service_onboarding(service_record: Dict[str, Any]) -> None:
    """
    Send service to onboarding queue.
    """
    message = {
        'action': 'onboard_service',
        'service_info': {
            'service_name': service_record['serviceName'],
            'service_type': service_record['serviceType'],
            'log_group_name': service_record['logGroupName'],
            'environment': service_record['environment'],
            'index_name': service_record.get('indexName'),
            'processor_type': service_record.get('processorType'),
            'opensearch_domain': service_record['opensearchDomain'],
            'custom_config': service_record.get('customConfig', {})
        },
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    
    sqs.send_message(
        QueueUrl=ONBOARDING_QUEUE_URL,
        MessageBody=json.dumps(message, default=str),
        MessageAttributes={
            'action': {
                'StringValue': 'onboard_service',
                'DataType': 'String'
            },
            'service_name': {
                'StringValue': service_record['serviceName'],
                'DataType': 'String'
            }
        }
    )
    
    logger.info(f"Queued onboarding for service: {service_record['serviceName']}")