import json
import boto3
import os
import subprocess
import tempfile
import shutil
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
dynamodb = boto3.resource('dynamodb')
ssm = boto3.client('ssm')
cloudformation = boto3.client('cloudformation')
sns = boto3.client('sns')

# Environment variables
SERVICE_REGISTRY_TABLE = os.environ['SERVICE_REGISTRY_TABLE']
STAGE = os.environ['STAGE']
OPENSEARCH_DOMAIN = os.environ['OPENSEARCH_DOMAIN']
CDK_STACK_NAME = os.environ['CDK_STACK_NAME']

# Service registry table
table = dynamodb.Table(SERVICE_REGISTRY_TABLE)

def handler(event, context):
    """
    Main handler for service onboarding Lambda function.
    Processes SQS messages to onboard new services automatically.
    """
    try:
        logger.info(f"Received event: {json.dumps(event, default=str)}")
        
        # Process SQS records
        for record in event['Records']:
            message_body = json.loads(record['body'])
            process_onboarding_message(message_body)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Onboarding process completed',
                'processed_records': len(event['Records'])
            })
        }
        
    except Exception as e:
        logger.error(f"Error in service onboarding: {str(e)}")
        raise

def process_onboarding_message(message: Dict[str, Any]) -> None:
    """
    Process a single onboarding message.
    """
    action = message.get('action')
    service_info = message.get('service_info')
    
    if action != 'onboard_service' or not service_info:
        logger.warning(f"Invalid message format: {message}")
        return
    
    service_name = service_info['service_name']
    environment = service_info['environment']
    
    logger.info(f"Processing onboarding for service: {service_name}")
    
    try:
        # Update service status to onboarding in progress
        update_service_status(service_name, environment, 'onboarding_in_progress')
        
        # Get service template configuration
        template_config = get_service_template(service_info)
        
        # Validate service configuration
        validation_result = validate_service_configuration(service_info, template_config)
        
        if not validation_result['valid']:
            logger.error(f"Service validation failed: {validation_result['errors']}")
            update_service_status(service_name, environment, 'validation_failed', 
                                validation_result['errors'])
            return
        
        # Generate CDK configuration
        cdk_config = generate_cdk_configuration(service_info, template_config)
        
        # Deploy infrastructure
        deployment_result = deploy_service_infrastructure(service_name, cdk_config)
        
        if deployment_result['success']:
            # Update service registry with deployment info
            update_service_status(service_name, environment, 'onboarded', 
                                deployment_info=deployment_result)
            
            # Create OpenSearch index templates
            create_opensearch_index_template(service_info, template_config)
            
            logger.info(f"Successfully onboarded service: {service_name}")
        else:
            update_service_status(service_name, environment, 'deployment_failed',
                                deployment_result.get('error'))
            
    except Exception as e:
        logger.error(f"Error onboarding service {service_name}: {str(e)}")
        update_service_status(service_name, environment, 'onboarding_failed', str(e))
        raise

def update_service_status(service_name: str, environment: str, status: str, 
                         error_details: Optional[str] = None, 
                         deployment_info: Optional[Dict] = None) -> None:
    """
    Update service status in the registry.
    """
    update_expression = 'SET #status = :status, lastUpdated = :timestamp'
    expression_values = {
        ':status': status,
        ':timestamp': datetime.now(timezone.utc).isoformat()
    }
    expression_names = {
        '#status': 'status'
    }
    
    if error_details:
        update_expression += ', errorDetails = :error'
        expression_values[':error'] = error_details
    
    if deployment_info:
        update_expression += ', deploymentInfo = :deployment'
        expression_values[':deployment'] = deployment_info
    
    try:
        table.update_item(
            Key={
                'serviceName': service_name,
                'environment': environment
            },
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values
        )
        logger.info(f"Updated service {service_name} status to {status}")
        
    except Exception as e:
        logger.error(f"Error updating service status: {str(e)}")
        raise

def get_service_template(service_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get service template configuration from SSM Parameter Store.
    """
    service_type = service_info.get('service_type', 'generic')
    template_path = f"/opensearch/{STAGE}/templates/{service_type}"
    
    try:
        response = ssm.get_parameter(Name=template_path)
        template_config = json.loads(response['Parameter']['Value'])
        logger.info(f"Retrieved template for service type: {service_type}")
        return template_config
        
    except ssm.exceptions.ParameterNotFound:
        logger.warning(f"No template found for service type {service_type}, using generic template")
        # Fallback to generic template
        try:
            response = ssm.get_parameter(Name=f"/opensearch/{STAGE}/templates/generic")
            return json.loads(response['Parameter']['Value'])
        except Exception as e:
            logger.error(f"Error retrieving generic template: {str(e)}")
            # Return minimal default template
            return {
                'indexName': f"{service_type}-logs",
                'processorType': 'generic',
                'filterPattern': '',
                'bufferInterval': 300,
                'bufferSize': 5,
                'retryDuration': 300
            }
    
    except Exception as e:
        logger.error(f"Error retrieving service template: {str(e)}")
        raise

def validate_service_configuration(service_info: Dict[str, Any], 
                                 template_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate service configuration before onboarding.
    """
    errors = []
    
    # Validate required fields
    required_fields = ['service_name', 'log_group_name', 'service_type', 'environment']
    for field in required_fields:
        if not service_info.get(field):
            errors.append(f"Missing required field: {field}")
    
    # Validate service name format
    service_name = service_info.get('service_name', '')
    if not service_name.replace('_', '').replace('-', '').isalnum():
        errors.append("Service name must contain only letters, numbers, hyphens, and underscores")
    
    # Validate log group name format
    log_group_name = service_info.get('log_group_name', '')
    if not log_group_name.startswith('/'):
        errors.append("Log group name must start with '/'")
    
    # Check for conflicts with existing services
    # Note: We only check for conflicts with services in 'onboarded' status
    # Services in 'onboarding_in_progress' are allowed since this could be the same onboarding process
    try:
        response = table.get_item(
            Key={
                'serviceName': service_info['service_name'],
                'environment': service_info['environment']
            }
        )
        
        if 'Item' in response:
            existing_service = response['Item']
            # Only consider it a conflict if the service is fully onboarded
            if existing_service['status'] == 'onboarded':
                errors.append(f"Service {service_info['service_name']} is already onboarded")
    
    except Exception as e:
        logger.warning(f"Error checking for existing service: {str(e)}")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors
    }

def generate_cdk_configuration(service_info: Dict[str, Any], 
                             template_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate CDK configuration for the service.
    """
    service_name = service_info['service_name']
    
    # Create service configuration that matches our CDK structure
    service_config = {
        'logGroupName': service_info['log_group_name'],
        'indexName': template_config.get('indexName', f"{service_name}-logs"),
        'processorType': template_config.get('processorType', service_info['service_type']),
        'enabled': True
    }
    
    # Generate full CDK configuration
    cdk_config = {
        'stage': service_info['environment'],
        'opensearch': {
            'domainName': OPENSEARCH_DOMAIN
        },
        'logs': {
            'services': {
                service_name: service_config
            }
        },
        'deployment': {
            'stackName': f"KinesisFirehose{service_name.title()}CDKStack-{OPENSEARCH_DOMAIN}",
            'templateConfig': template_config
        }
    }
    
    logger.info(f"Generated CDK configuration for {service_name}: {json.dumps(cdk_config, indent=2)}")
    return cdk_config

def deploy_service_infrastructure(service_name: str, cdk_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deploy infrastructure for the service using CDK.
    This creates a CloudFormation template and deploys it.
    """
    try:
        # For this implementation, we'll create a CloudFormation template
        # In production, this would trigger a CDK deployment
        
        template = generate_cloudformation_template(service_name, cdk_config)
        stack_name = cdk_config['deployment']['stackName']
        
        # Check if stack already exists
        stack_exists = check_stack_exists(stack_name)
        
        if stack_exists:
            logger.info(f"Updating existing stack: {stack_name}")
            operation = 'update'
            response = cloudformation.update_stack(
                StackName=stack_name,
                TemplateBody=json.dumps(template),
                Capabilities=['CAPABILITY_IAM']
            )
        else:
            logger.info(f"Creating new stack: {stack_name}")
            operation = 'create'
            response = cloudformation.create_stack(
                StackName=stack_name,
                TemplateBody=json.dumps(template),
                Capabilities=['CAPABILITY_IAM']
            )
        
        stack_id = response['StackId']
        
        # Wait for stack operation to complete (simplified - in production use waiter)
        logger.info(f"Stack {operation} initiated: {stack_id}")
        
        return {
            'success': True,
            'stackId': stack_id,
            'stackName': stack_name,
            'operation': operation,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error deploying infrastructure for {service_name}: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'timestamp': datetime.now(timezone.utc).isoformat()
        }

def check_stack_exists(stack_name: str) -> bool:
    """
    Check if CloudFormation stack already exists.
    """
    try:
        cloudformation.describe_stacks(StackName=stack_name)
        return True
    except cloudformation.exceptions.ClientError as e:
        if 'does not exist' in str(e):
            return False
        raise

def generate_cloudformation_template(service_name: str, cdk_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate a CloudFormation template for the service infrastructure.
    This is a simplified version - in production, CDK would generate this.
    """
    service_config = cdk_config['logs']['services'][service_name]
    template_config = cdk_config['deployment']['templateConfig']
    
    # Simplified CloudFormation template
    template = {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Description": f"OpenSearch logging infrastructure for service: {service_name}",
        "Resources": {
            f"{service_name}FirehoseDeliveryStream": {
                "Type": "AWS::KinesisFirehose::DeliveryStream",
                "Properties": {
                    "DeliveryStreamName": f"{service_config['indexName']}-{OPENSEARCH_DOMAIN}",
                    "DeliveryStreamType": "DirectPut",
                    "AmazonopensearchserviceDestinationConfiguration": {
                        "IndexName": service_config['indexName'],
                        "DomainARN": f"arn:aws:es:{boto3.Session().region_name}:{boto3.client('sts').get_caller_identity()['Account']}:domain/{OPENSEARCH_DOMAIN}",
                        "RoleARN": f"arn:aws:iam::{boto3.client('sts').get_caller_identity()['Account']}:role/service-role/firehose_delivery_role",
                        "BufferingHints": {
                            "IntervalInSeconds": template_config.get('bufferInterval', 60),
                            "SizeInMBs": template_config.get('bufferSize', 5)
                        },
                        "RetryOptions": {
                            "DurationInSeconds": template_config.get('retryDuration', 300)
                        }
                    }
                }
            },
            f"{service_name}SubscriptionFilter": {
                "Type": "AWS::Logs::SubscriptionFilter",
                "Properties": {
                    "LogGroupName": service_config['logGroupName'],
                    "FilterPattern": template_config.get('filterPattern', ''),
                    "DestinationArn": {
                        "Fn::GetAtt": [f"{service_name}FirehoseDeliveryStream", "Arn"]
                    }
                }
            }
        },
        "Outputs": {
            "DeliveryStreamName": {
                "Value": {"Ref": f"{service_name}FirehoseDeliveryStream"},
                "Description": f"Firehose delivery stream for {service_name}"
            }
        }
    }
    
    return template

def create_opensearch_index_template(service_info: Dict[str, Any], 
                                   template_config: Dict[str, Any]) -> None:
    """
    Create OpenSearch index template for the service.
    This would typically use the OpenSearch API to create index templates.
    """
    service_name = service_info['service_name']
    index_name = template_config.get('indexName', f"{service_name}-logs")
    
    # Store template configuration for later use by OpenSearch management
    template_param_name = f"/opensearch/{STAGE}/index-templates/{service_name}"
    
    index_template = {
        'index_patterns': [f"{index_name}-*"],
        'template': template_config.get('indexMapping', {
            'properties': {
                'timestamp': {'type': 'date'},
                'message': {'type': 'text'},
                'service': {'type': 'keyword'},
                'level': {'type': 'keyword'}
            }
        }),
        'settings': {
            'number_of_shards': 1,
            'number_of_replicas': 1,
            'refresh_interval': '30s'
        }
    }
    
    try:
        ssm.put_parameter(
            Name=template_param_name,
            Value=json.dumps(index_template),
            Type='String',
            Overwrite=True,
            Description=f"OpenSearch index template for {service_name}"
        )
        
        logger.info(f"Created OpenSearch index template parameter for {service_name}")
        
    except Exception as e:
        logger.error(f"Error creating index template for {service_name}: {str(e)}")
        # Don't fail the entire onboarding for this