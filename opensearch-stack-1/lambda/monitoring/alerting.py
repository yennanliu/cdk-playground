import json
import boto3
import os
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any
import logging
import requests

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
dynamodb = boto3.resource('dynamodb')
sns = boto3.client('sns')
cloudwatch = boto3.client('cloudwatch')

# Environment variables
SERVICE_REGISTRY_TABLE = os.environ['SERVICE_REGISTRY_TABLE']
NOTIFICATION_TOPIC_ARN = os.environ['NOTIFICATION_TOPIC_ARN']
STAGE = os.environ['STAGE']
OPENSEARCH_DOMAIN = os.environ['OPENSEARCH_DOMAIN']
SLACK_WEBHOOK = os.environ.get('SLACK_WEBHOOK', '')

# Service registry table
table = dynamodb.Table(SERVICE_REGISTRY_TABLE)

def handler(event, context):
    """
    Main handler for alerting Lambda function.
    """
    try:
        logger.info(f"Received event: {json.dumps(event, default=str)}")
        
        # Handle different event sources
        if 'source' in event:
            if event['source'] == 'dlq-message':
                handle_dlq_alert(event)
            elif event['source'] == 'cloudformation-failure':
                handle_cfn_failure(event)
            elif event['source'] == 'scheduled-alert':
                handle_scheduled_alert(event)
        elif 'Records' in event:
            # Handle SNS messages
            for record in event['Records']:
                if record['EventSource'] == 'aws:sns':
                    handle_sns_alert(record)
        else:
            # Direct invocation
            handle_direct_alert(event)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Alert processed successfully'
            })
        }
        
    except Exception as e:
        logger.error(f"Error in alerting handler: {str(e)}")
        raise

def handle_dlq_alert(event: Dict[str, Any]) -> None:
    """
    Handle Dead Letter Queue alerts.
    """
    message = "⚠️ **CRITICAL ALERT**: Message sent to Dead Letter Queue"
    details = f"""
**Environment**: {STAGE}
**OpenSearch Domain**: {OPENSEARCH_DOMAIN}
**Alert Type**: DLQ Message
**Timestamp**: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}

A message has been sent to the Dead Letter Queue, indicating repeated processing failures.
Please investigate the onboarding process immediately.
    """
    
    send_notification(message, details, severity='critical')

def handle_cfn_failure(event: Dict[str, Any]) -> None:
    """
    Handle CloudFormation stack failure alerts.
    """
    stack_name = event.get('stackName', 'Unknown')
    status = event.get('status', 'Unknown')
    
    message = f"🚨 **CloudFormation Stack Failure**: {stack_name}"
    details = f"""
**Environment**: {STAGE}
**Stack Name**: {stack_name}
**Status**: {status}
**Timestamp**: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}

A CloudFormation stack operation has failed. This may affect service onboarding.
Please check the CloudFormation console for detailed error information.
    """
    
    send_notification(message, details, severity='high')
    
    # Update affected services in registry
    update_affected_services(stack_name, 'deployment_failed', f'CloudFormation stack failed: {status}')

def handle_scheduled_alert(event: Dict[str, Any]) -> None:
    """
    Handle scheduled alert checks.
    """
    # Check for services stuck in onboarding
    stuck_services = check_stuck_services()
    
    if stuck_services:
        message = f"⚠️ **Service Onboarding Alert**: {len(stuck_services)} services stuck in onboarding"
        details = generate_stuck_services_report(stuck_services)
        send_notification(message, details, severity='medium')
    
    # Check for high failure rate
    failure_rate = check_failure_rate()
    
    if failure_rate > 0.5:  # More than 50% failure rate
        message = f"🚨 **High Failure Rate Alert**: {failure_rate*100:.1f}% of recent onboarding attempts failed"
        details = generate_failure_rate_report()
        send_notification(message, details, severity='high')

def handle_sns_alert(record: Dict[str, Any]) -> None:
    """
    Handle SNS-triggered alerts (from CloudWatch alarms).
    """
    sns_message = json.loads(record['Sns']['Message'])
    
    alarm_name = sns_message.get('AlarmName', 'Unknown Alarm')
    new_state = sns_message.get('NewStateValue', 'UNKNOWN')
    reason = sns_message.get('NewStateReason', 'No reason provided')
    
    message = f"📊 **CloudWatch Alarm**: {alarm_name}"
    details = f"""
**Environment**: {STAGE}
**Alarm Name**: {alarm_name}
**State**: {new_state}
**Reason**: {reason}
**Timestamp**: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}

{reason}
    """
    
    severity = 'high' if new_state == 'ALARM' else 'low'
    send_notification(message, details, severity=severity)

def handle_direct_alert(event: Dict[str, Any]) -> None:
    """
    Handle direct invocation alerts.
    """
    alert_type = event.get('alertType', 'info')
    message = event.get('message', 'Custom alert')
    details = event.get('details', 'No additional details provided')
    
    send_notification(f"🔔 **Custom Alert**: {message}", details, severity=alert_type)

def check_stuck_services() -> List[Dict[str, Any]]:
    """
    Check for services that have been in onboarding status for too long.
    """
    stuck_services = []
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=2)
    
    try:
        # Query services in onboarding status
        response = table.query(
            IndexName='StatusIndex',
            KeyConditionExpression='#status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'onboarding_in_progress'}
        )
        
        for service in response['Items']:
            last_updated = datetime.fromisoformat(service['lastUpdated'].replace('Z', '+00:00'))
            
            if last_updated < cutoff_time:
                stuck_services.append({
                    'serviceName': service['serviceName'],
                    'environment': service['environment'],
                    'lastUpdated': service['lastUpdated'],
                    'serviceType': service.get('serviceType', 'unknown')
                })
    
    except Exception as e:
        logger.error(f"Error checking stuck services: {str(e)}")
    
    return stuck_services

def check_failure_rate() -> float:
    """
    Check the recent failure rate of service onboarding.
    """
    try:
        # Get services from the last 24 hours
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
        
        response = table.scan()
        recent_services = []
        
        for service in response['Items']:
            last_updated = datetime.fromisoformat(service['lastUpdated'].replace('Z', '+00:00'))
            
            if last_updated > cutoff_time:
                recent_services.append(service)
        
        if not recent_services:
            return 0.0
        
        failed_count = len([s for s in recent_services if s.get('status') in ['onboarding_failed', 'deployment_failed', 'validation_failed']])
        
        return failed_count / len(recent_services)
    
    except Exception as e:
        logger.error(f"Error checking failure rate: {str(e)}")
        return 0.0

def generate_stuck_services_report(stuck_services: List[Dict[str, Any]]) -> str:
    """
    Generate a report for services stuck in onboarding.
    """
    details = f"""
**Environment**: {STAGE}
**Stuck Services Count**: {len(stuck_services)}
**Timestamp**: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}

**Services stuck in onboarding for more than 2 hours:**
"""
    
    for service in stuck_services:
        details += f"""
- **{service['serviceName']}** ({service['serviceType']})
  - Environment: {service['environment']}
  - Last Updated: {service['lastUpdated']}
"""
    
    details += """
**Recommended Actions:**
1. Check CloudFormation console for stack deployment issues
2. Review Lambda function logs for errors
3. Verify OpenSearch domain accessibility
4. Consider manual intervention for stuck services
    """
    
    return details

def generate_failure_rate_report() -> str:
    """
    Generate a failure rate report.
    """
    try:
        # Get detailed failure breakdown
        response = table.query(
            IndexName='StatusIndex',
            KeyConditionExpression='#status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'onboarding_failed'}
        )
        
        failed_services = response['Items']
        
        details = f"""
**Environment**: {STAGE}
**Failed Services**: {len(failed_services)}
**Timestamp**: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}

**Recent Failures:**
"""
        
        for service in failed_services[:5]:  # Show up to 5 recent failures
            error_details = service.get('errorDetails', 'No error details available')
            details += f"""
- **{service['serviceName']}** ({service.get('serviceType', 'unknown')})
  - Error: {error_details}
  - Last Updated: {service['lastUpdated']}
"""
        
        if len(failed_services) > 5:
            details += f"\n... and {len(failed_services) - 5} more failed services"
        
        return details
        
    except Exception as e:
        logger.error(f"Error generating failure report: {str(e)}")
        return "Error generating failure report"

def update_affected_services(stack_name: str, status: str, error_details: str) -> None:
    """
    Update services affected by CloudFormation stack failure.
    """
    try:
        # This is a simplified approach - in production, you'd track stack-to-service mapping
        # For now, we'll scan for services that might be affected
        response = table.scan()
        
        for service in response['Items']:
            # Check if service deployment info references this stack
            deployment_info = service.get('deploymentInfo', {})
            if isinstance(deployment_info, dict) and stack_name in str(deployment_info.get('stackName', '')):
                table.update_item(
                    Key={
                        'serviceName': service['serviceName'],
                        'environment': service['environment']
                    },
                    UpdateExpression='SET #status = :status, errorDetails = :error, lastUpdated = :timestamp',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': status,
                        ':error': error_details,
                        ':timestamp': datetime.now(timezone.utc).isoformat()
                    }
                )
                
                logger.info(f"Updated service {service['serviceName']} status due to stack failure")
    
    except Exception as e:
        logger.error(f"Error updating affected services: {str(e)}")

def send_notification(message: str, details: str, severity: str = 'medium') -> None:
    """
    Send notification via SNS and optionally Slack.
    """
    try:
        # Publish custom CloudWatch metrics
        publish_alert_metrics(severity)
        
        # Send SNS notification
        sns_message = f"{message}\n\n{details}"
        
        sns.publish(
            TopicArn=NOTIFICATION_TOPIC_ARN,
            Message=sns_message,
            Subject=f"OpenSearch Service Alert - {STAGE.upper()}",
            MessageAttributes={
                'severity': {
                    'DataType': 'String',
                    'StringValue': severity
                },
                'environment': {
                    'DataType': 'String', 
                    'StringValue': STAGE
                }
            }
        )
        
        # Send Slack notification if webhook is configured
        if SLACK_WEBHOOK:
            send_slack_notification(message, details, severity)
        
        logger.info(f"Notification sent: {severity} - {message}")
        
    except Exception as e:
        logger.error(f"Error sending notification: {str(e)}")

def send_slack_notification(message: str, details: str, severity: str) -> None:
    """
    Send notification to Slack webhook.
    """
    try:
        # Color code by severity
        color_map = {
            'critical': '#ff0000',  # Red
            'high': '#ff6600',      # Orange
            'medium': '#ffcc00',    # Yellow
            'low': '#00cc00',       # Green
            'info': '#0066cc'       # Blue
        }
        
        color = color_map.get(severity, '#808080')
        
        payload = {
            'attachments': [{
                'color': color,
                'title': message,
                'text': details,
                'footer': f"OpenSearch Service Management - {STAGE}",
                'ts': int(datetime.now().timestamp())
            }]
        }
        
        response = requests.post(SLACK_WEBHOOK, json=payload, timeout=10)
        response.raise_for_status()
        
        logger.info("Slack notification sent successfully")
        
    except Exception as e:
        logger.error(f"Error sending Slack notification: {str(e)}")

def publish_alert_metrics(severity: str) -> None:
    """
    Publish custom CloudWatch metrics for alerting.
    """
    try:
        cloudwatch.put_metric_data(
            Namespace='OpenSearch/ServiceManagement',
            MetricData=[
                {
                    'MetricName': 'AlertsGenerated',
                    'Dimensions': [
                        {'Name': 'Environment', 'Value': STAGE},
                        {'Name': 'Severity', 'Value': severity}
                    ],
                    'Value': 1,
                    'Unit': 'Count',
                    'Timestamp': datetime.now(timezone.utc)
                }
            ]
        )
        
    except Exception as e:
        logger.error(f"Error publishing alert metrics: {str(e)}")