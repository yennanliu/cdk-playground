import json
import boto3
import os
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')
sns = boto3.client('sns')
cloudwatch = boto3.client('cloudwatch')
opensearch = boto3.client('opensearchserverless')
es = boto3.client('es')  # For legacy Elasticsearch domains
logs_client = boto3.client('logs')
firehose = boto3.client('firehose')

# Environment variables
SERVICE_REGISTRY_TABLE = os.environ['SERVICE_REGISTRY_TABLE']
NOTIFICATION_TOPIC_ARN = os.environ['NOTIFICATION_TOPIC_ARN']
ONBOARDING_QUEUE_URL = os.environ['ONBOARDING_QUEUE_URL']
STAGE = os.environ['STAGE']
OPENSEARCH_DOMAIN = os.environ['OPENSEARCH_DOMAIN']

# Service registry table
table = dynamodb.Table(SERVICE_REGISTRY_TABLE)

def handler(event, context):
    """
    Main handler for health check Lambda function.
    """
    try:
        logger.info(f"Starting health check: {json.dumps(event, default=str)}")
        
        health_report = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'environment': STAGE,
            'opensearch_domain': OPENSEARCH_DOMAIN,
            'checks': {}
        }
        
        # Perform all health checks
        health_report['checks']['service_registry'] = check_service_registry()
        health_report['checks']['onboarding_queue'] = check_onboarding_queue()
        health_report['checks']['opensearch_domain'] = check_opensearch_domain()
        health_report['checks']['firehose_streams'] = check_firehose_streams()
        health_report['checks']['service_metrics'] = check_service_metrics()
        health_report['checks']['log_groups'] = check_log_groups()
        
        # Calculate overall health status
        health_report['overall_status'] = calculate_overall_status(health_report['checks'])
        
        # Publish metrics to CloudWatch
        publish_health_metrics(health_report)
        
        # Send alerts if needed
        handle_health_alerts(health_report)
        
        # Trigger recovery actions if needed
        trigger_recovery_actions(health_report)
        
        logger.info(f"Health check completed with status: {health_report['overall_status']}")
        
        return {
            'statusCode': 200,
            'body': json.dumps(health_report, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error in health check: {str(e)}")
        
        # Send critical alert
        send_alert(
            'CRITICAL: Health check failed',
            f'Health check Lambda function failed with error: {str(e)}',
            'critical'
        )
        
        raise

def check_service_registry() -> Dict[str, Any]:
    """
    Check the health of the service registry (DynamoDB table).
    """
    try:
        # Check table accessibility
        table.describe_table()
        
        # Get service statistics
        response = table.scan(Select='COUNT')
        total_services = response['Count']
        
        # Count services by status
        status_counts = {}
        
        # Scan with status filtering
        for status in ['discovered', 'registered', 'onboarding_in_progress', 'onboarded', 'onboarding_failed']:
            try:
                response = table.query(
                    IndexName='StatusIndex',
                    KeyConditionExpression='#status = :status',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={':status': status},
                    Select='COUNT'
                )
                status_counts[status] = response['Count']
            except Exception as e:
                logger.warning(f"Error counting services with status {status}: {str(e)}")
                status_counts[status] = 0
        
        # Check for stale services (no update in last 7 days)
        cutoff_time = datetime.now(timezone.utc) - timedelta(days=7)
        stale_count = 0
        
        try:
            response = table.scan()
            for service in response['Items']:
                last_updated = datetime.fromisoformat(service['lastUpdated'].replace('Z', '+00:00'))
                if last_updated < cutoff_time:
                    stale_count += 1
        except Exception as e:
            logger.warning(f"Error checking stale services: {str(e)}")
        
        return {
            'status': 'healthy',
            'total_services': total_services,
            'status_counts': status_counts,
            'stale_services': stale_count,
            'details': 'Service registry is accessible and functioning'
        }
        
    except Exception as e:
        logger.error(f"Service registry health check failed: {str(e)}")
        return {
            'status': 'unhealthy',
            'error': str(e),
            'details': 'Service registry is not accessible'
        }

def check_onboarding_queue() -> Dict[str, Any]:
    """
    Check the health of the onboarding SQS queue.
    """
    try:
        # Get queue attributes
        response = sqs.get_queue_attributes(
            QueueUrl=ONBOARDING_QUEUE_URL,
            AttributeNames=['All']
        )
        
        attributes = response['Attributes']
        visible_messages = int(attributes.get('ApproximateNumberOfMessages', '0'))
        messages_in_flight = int(attributes.get('ApproximateNumberOfMessagesNotVisible', '0'))
        dlq_messages = 0
        
        # Check DLQ if it exists
        dlq_url = attributes.get('RedrivePolicy')
        if dlq_url:
            try:
                dlq_response = sqs.get_queue_attributes(
                    QueueUrl=dlq_url,
                    AttributeNames=['ApproximateNumberOfMessages']
                )
                dlq_messages = int(dlq_response['Attributes']['ApproximateNumberOfMessages'])
            except Exception as e:
                logger.warning(f"Error checking DLQ: {str(e)}")
        
        # Determine health status
        status = 'healthy'
        details = 'Queue is functioning normally'
        
        if visible_messages > 20:
            status = 'warning'
            details = f'High queue depth: {visible_messages} messages'
        elif dlq_messages > 0:
            status = 'unhealthy'
            details = f'Messages in DLQ: {dlq_messages}'
        
        return {
            'status': status,
            'visible_messages': visible_messages,
            'messages_in_flight': messages_in_flight,
            'dlq_messages': dlq_messages,
            'details': details
        }
        
    except Exception as e:
        logger.error(f"Queue health check failed: {str(e)}")
        return {
            'status': 'unhealthy',
            'error': str(e),
            'details': 'Cannot access onboarding queue'
        }

def check_opensearch_domain() -> Dict[str, Any]:
    """
    Check the health of the OpenSearch domain.
    """
    try:
        # Try OpenSearch first, then fall back to Elasticsearch
        try:
            response = opensearch.describe_domain(DomainName=OPENSEARCH_DOMAIN)
            domain_status = response['DomainStatus']
        except Exception:
            # Fall back to Elasticsearch client
            response = es.describe_elasticsearch_domain(DomainName=OPENSEARCH_DOMAIN)
            domain_status = response['DomainStatus']
        
        processing = domain_status.get('Processing', False)
        domain_status_name = domain_status.get('DomainStatus', 'Unknown')
        
        # Check cluster health
        cluster_config = domain_status.get('ClusterConfig', {})
        instance_count = cluster_config.get('InstanceCount', 0)
        instance_type = cluster_config.get('InstanceType', 'unknown')
        
        # Check EBS configuration
        ebs_config = domain_status.get('EBSOptions', {})
        volume_size = ebs_config.get('VolumeSize', 0)
        
        # Determine health status
        status = 'healthy'
        details = 'OpenSearch domain is active and healthy'
        
        if processing:
            status = 'warning'
            details = 'Domain is currently processing changes'
        elif domain_status_name != 'Active':
            status = 'unhealthy'
            details = f'Domain status is {domain_status_name}'
        
        return {
            'status': status,
            'domain_status': domain_status_name,
            'processing': processing,
            'instance_count': instance_count,
            'instance_type': instance_type,
            'volume_size': volume_size,
            'details': details
        }
        
    except Exception as e:
        logger.error(f"OpenSearch domain health check failed: {str(e)}")
        return {
            'status': 'unhealthy',
            'error': str(e),
            'details': 'Cannot access OpenSearch domain'
        }

def check_firehose_streams() -> Dict[str, Any]:
    """
    Check the health of Firehose delivery streams.
    """
    try:
        # List all delivery streams
        response = firehose.list_delivery_streams(Limit=100)
        stream_names = response['DeliveryStreamNames']
        
        # Filter streams related to our OpenSearch domain
        our_streams = [name for name in stream_names if OPENSEARCH_DOMAIN in name.lower()]
        
        stream_health = {}
        healthy_count = 0
        
        for stream_name in our_streams:
            try:
                stream_response = firehose.describe_delivery_stream(
                    DeliveryStreamName=stream_name
                )
                
                stream_status = stream_response['DeliveryStreamDescription']['DeliveryStreamStatus']
                
                if stream_status == 'ACTIVE':
                    stream_health[stream_name] = 'healthy'
                    healthy_count += 1
                else:
                    stream_health[stream_name] = f'unhealthy ({stream_status})'
                    
            except Exception as e:
                logger.warning(f"Error checking stream {stream_name}: {str(e)}")
                stream_health[stream_name] = f'error ({str(e)})'
        
        # Determine overall status
        if not our_streams:
            status = 'warning'
            details = 'No Firehose streams found for this domain'
        elif healthy_count == len(our_streams):
            status = 'healthy'
            details = f'All {len(our_streams)} streams are active'
        else:
            status = 'warning'
            details = f'{healthy_count}/{len(our_streams)} streams are healthy'
        
        return {
            'status': status,
            'total_streams': len(our_streams),
            'healthy_streams': healthy_count,
            'stream_health': stream_health,
            'details': details
        }
        
    except Exception as e:
        logger.error(f"Firehose health check failed: {str(e)}")
        return {
            'status': 'unhealthy',
            'error': str(e),
            'details': 'Cannot access Firehose streams'
        }

def check_service_metrics() -> Dict[str, Any]:
    """
    Check service onboarding metrics and trends.
    """
    try:
        # Get recent onboarding metrics
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(hours=24)
        
        # Get service registry metrics
        response = table.scan()
        services = response['Items']
        
        # Filter services updated in the last 24 hours
        recent_services = []
        for service in services:
            try:
                last_updated = datetime.fromisoformat(service['lastUpdated'].replace('Z', '+00:00'))
                if last_updated >= start_time:
                    recent_services.append(service)
            except Exception:
                continue
        
        # Calculate metrics
        total_recent = len(recent_services)
        successful = len([s for s in recent_services if s.get('status') == 'onboarded'])
        failed = len([s for s in recent_services if s.get('status') in ['onboarding_failed', 'deployment_failed', 'validation_failed']])
        in_progress = len([s for s in recent_services if s.get('status') == 'onboarding_in_progress'])
        
        # Calculate success rate
        success_rate = (successful / total_recent) if total_recent > 0 else 0
        
        # Determine status
        status = 'healthy'
        details = f'Success rate: {success_rate*100:.1f}%'
        
        if success_rate < 0.5 and total_recent > 0:
            status = 'warning'
            details = f'Low success rate: {success_rate*100:.1f}% ({successful}/{total_recent})'
        elif in_progress > 10:
            status = 'warning'
            details = f'Many services in progress: {in_progress}'
        
        return {
            'status': status,
            'recent_services': total_recent,
            'successful': successful,
            'failed': failed,
            'in_progress': in_progress,
            'success_rate': success_rate,
            'details': details
        }
        
    except Exception as e:
        logger.error(f"Service metrics check failed: {str(e)}")
        return {
            'status': 'error',
            'error': str(e),
            'details': 'Cannot calculate service metrics'
        }

def check_log_groups() -> Dict[str, Any]:
    """
    Check for orphaned log groups and subscription filter health.
    """
    try:
        # Get all services and their log groups
        response = table.scan()
        services = response['Items']
        
        monitored_log_groups = set()
        for service in services:
            if service.get('logGroupName') and service.get('status') == 'onboarded':
                monitored_log_groups.add(service['logGroupName'])
        
        # Check subscription filters for monitored log groups
        healthy_subscriptions = 0
        total_monitored = len(monitored_log_groups)
        subscription_issues = []
        
        for log_group_name in monitored_log_groups:
            try:
                response = logs_client.describe_subscription_filters(
                    logGroupName=log_group_name
                )
                
                filters = response['subscriptionFilters']
                if filters:
                    healthy_subscriptions += 1
                else:
                    subscription_issues.append(f"{log_group_name}: No subscription filter")
                    
            except logs_client.exceptions.ResourceNotFoundException:
                subscription_issues.append(f"{log_group_name}: Log group not found")
            except Exception as e:
                subscription_issues.append(f"{log_group_name}: {str(e)}")
        
        # Determine status
        if total_monitored == 0:
            status = 'warning'
            details = 'No monitored log groups found'
        elif healthy_subscriptions == total_monitored:
            status = 'healthy'
            details = f'All {total_monitored} log groups have subscription filters'
        else:
            status = 'warning'
            details = f'{healthy_subscriptions}/{total_monitored} log groups have healthy subscriptions'
        
        return {
            'status': status,
            'monitored_log_groups': total_monitored,
            'healthy_subscriptions': healthy_subscriptions,
            'subscription_issues': subscription_issues[:10],  # Limit to first 10 issues
            'details': details
        }
        
    except Exception as e:
        logger.error(f"Log groups health check failed: {str(e)}")
        return {
            'status': 'error',
            'error': str(e),
            'details': 'Cannot check log group health'
        }

def calculate_overall_status(checks: Dict[str, Any]) -> str:
    """
    Calculate overall health status based on individual check results.
    """
    statuses = [check.get('status', 'unknown') for check in checks.values()]
    
    if 'unhealthy' in statuses:
        return 'unhealthy'
    elif 'warning' in statuses:
        return 'warning'
    elif 'error' in statuses:
        return 'error'
    elif all(status == 'healthy' for status in statuses):
        return 'healthy'
    else:
        return 'unknown'

def publish_health_metrics(health_report: Dict[str, Any]) -> None:
    """
    Publish health metrics to CloudWatch.
    """
    try:
        metrics = []
        timestamp = datetime.now(timezone.utc)
        
        # Overall health metric
        health_value = {
            'healthy': 1,
            'warning': 0.5,
            'unhealthy': 0,
            'error': 0
        }.get(health_report['overall_status'], 0)
        
        metrics.append({
            'MetricName': 'OverallHealth',
            'Dimensions': [{'Name': 'Environment', 'Value': STAGE}],
            'Value': health_value,
            'Unit': 'None',
            'Timestamp': timestamp
        })
        
        # Service registry metrics
        if 'service_registry' in health_report['checks']:
            registry_check = health_report['checks']['service_registry']
            
            if 'total_services' in registry_check:
                metrics.append({
                    'MetricName': 'TotalServices',
                    'Dimensions': [{'Name': 'Environment', 'Value': STAGE}],
                    'Value': registry_check['total_services'],
                    'Unit': 'Count',
                    'Timestamp': timestamp
                })
            
            if 'status_counts' in registry_check:
                for status, count in registry_check['status_counts'].items():
                    metrics.append({
                        'MetricName': 'ServicesByStatus',
                        'Dimensions': [
                            {'Name': 'Environment', 'Value': STAGE},
                            {'Name': 'Status', 'Value': status}
                        ],
                        'Value': count,
                        'Unit': 'Count',
                        'Timestamp': timestamp
                    })
        
        # Service metrics
        if 'service_metrics' in health_report['checks']:
            service_check = health_report['checks']['service_metrics']
            
            if 'success_rate' in service_check:
                metrics.append({
                    'MetricName': 'OnboardingSuccessRate',
                    'Dimensions': [{'Name': 'Environment', 'Value': STAGE}],
                    'Value': service_check['success_rate'],
                    'Unit': 'Percent',
                    'Timestamp': timestamp
                })
        
        # Publish metrics in batches (CloudWatch limit is 20 per request)
        batch_size = 20
        for i in range(0, len(metrics), batch_size):
            batch = metrics[i:i + batch_size]
            cloudwatch.put_metric_data(
                Namespace='OpenSearch/ServiceManagement',
                MetricData=batch
            )
        
        logger.info(f"Published {len(metrics)} health metrics to CloudWatch")
        
    except Exception as e:
        logger.error(f"Error publishing health metrics: {str(e)}")

def handle_health_alerts(health_report: Dict[str, Any]) -> None:
    """
    Send alerts based on health check results.
    """
    overall_status = health_report['overall_status']
    
    if overall_status in ['unhealthy', 'error']:
        # Generate detailed alert message
        issues = []
        for check_name, check_result in health_report['checks'].items():
            if check_result.get('status') in ['unhealthy', 'error']:
                issues.append(f"**{check_name.replace('_', ' ').title()}**: {check_result.get('details', 'Unknown issue')}")
        
        message = f"🚨 **OpenSearch Service Health Alert**: System is {overall_status}"
        details = f"""
**Environment**: {STAGE}
**OpenSearch Domain**: {OPENSEARCH_DOMAIN}
**Overall Status**: {overall_status.upper()}
**Timestamp**: {health_report['timestamp']}

**Issues Detected:**
{chr(10).join(issues)}

**Recommended Actions:**
1. Check the OpenSearch service management dashboard
2. Review CloudFormation stacks for deployment issues
3. Verify OpenSearch domain accessibility
4. Check Lambda function logs for errors
        """
        
        send_alert(message, details, 'high')
    
    elif overall_status == 'warning':
        # Send lower priority warning
        warnings = []
        for check_name, check_result in health_report['checks'].items():
            if check_result.get('status') == 'warning':
                warnings.append(f"**{check_name.replace('_', ' ').title()}**: {check_result.get('details', 'Warning condition')}")
        
        message = f"⚠️ **OpenSearch Service Warning**: System has warnings"
        details = f"""
**Environment**: {STAGE}
**OpenSearch Domain**: {OPENSEARCH_DOMAIN}
**Overall Status**: WARNING
**Timestamp**: {health_report['timestamp']}

**Warnings:**
{chr(10).join(warnings)}
        """
        
        send_alert(message, details, 'medium')

def trigger_recovery_actions(health_report: Dict[str, Any]) -> None:
    """
    Trigger automated recovery actions based on health check results.
    """
    try:
        # Recovery action 1: Retry failed services
        if 'service_metrics' in health_report['checks']:
            service_metrics = health_report['checks']['service_metrics']
            if service_metrics.get('failed', 0) > 0:
                retry_failed_services()
        
        # Recovery action 2: Clear stuck services
        if 'service_registry' in health_report['checks']:
            clear_stuck_services()
        
        logger.info("Recovery actions completed")
        
    except Exception as e:
        logger.error(f"Error in recovery actions: {str(e)}")

def retry_failed_services() -> None:
    """
    Retry services that failed onboarding more than 1 hour ago.
    """
    try:
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=1)
        
        response = table.query(
            IndexName='StatusIndex',
            KeyConditionExpression='#status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'onboarding_failed'}
        )
        
        retry_count = 0
        for service in response['Items']:
            last_updated = datetime.fromisoformat(service['lastUpdated'].replace('Z', '+00:00'))
            
            if last_updated < cutoff_time:
                # Reset service status and queue for retry
                table.update_item(
                    Key={
                        'serviceName': service['serviceName'],
                        'environment': service['environment']
                    },
                    UpdateExpression='SET #status = :status, lastUpdated = :timestamp, retryCount = if_not_exists(retryCount, :zero) + :one',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': 'registered',
                        ':timestamp': datetime.now(timezone.utc).isoformat(),
                        ':zero': 0,
                        ':one': 1
                    }
                )
                
                # Queue for onboarding
                message = {
                    'action': 'onboard_service',
                    'service_info': {
                        'service_name': service['serviceName'],
                        'service_type': service.get('serviceType', 'unknown'),
                        'log_group_name': service.get('logGroupName', ''),
                        'environment': service['environment'],
                        'retry': True
                    },
                    'timestamp': datetime.now(timezone.utc).isoformat()
                }
                
                sqs.send_message(
                    QueueUrl=ONBOARDING_QUEUE_URL,
                    MessageBody=json.dumps(message, default=str)
                )
                
                retry_count += 1
        
        if retry_count > 0:
            logger.info(f"Queued {retry_count} failed services for retry")
        
    except Exception as e:
        logger.error(f"Error retrying failed services: {str(e)}")

def clear_stuck_services() -> None:
    """
    Clear services stuck in onboarding_in_progress for more than 4 hours.
    """
    try:
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=4)
        
        response = table.query(
            IndexName='StatusIndex',
            KeyConditionExpression='#status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'onboarding_in_progress'}
        )
        
        cleared_count = 0
        for service in response['Items']:
            last_updated = datetime.fromisoformat(service['lastUpdated'].replace('Z', '+00:00'))
            
            if last_updated < cutoff_time:
                # Mark as failed due to timeout
                table.update_item(
                    Key={
                        'serviceName': service['serviceName'],
                        'environment': service['environment']
                    },
                    UpdateExpression='SET #status = :status, errorDetails = :error, lastUpdated = :timestamp',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': 'onboarding_failed',
                        ':error': 'Onboarding timeout - cleared by health check',
                        ':timestamp': datetime.now(timezone.utc).isoformat()
                    }
                )
                
                cleared_count += 1
        
        if cleared_count > 0:
            logger.info(f"Cleared {cleared_count} stuck services")
        
    except Exception as e:
        logger.error(f"Error clearing stuck services: {str(e)}")

def send_alert(message: str, details: str, severity: str) -> None:
    """
    Send health alert notification.
    """
    try:
        sns.publish(
            TopicArn=NOTIFICATION_TOPIC_ARN,
            Message=f"{message}\n\n{details}",
            Subject=f"OpenSearch Health Alert - {STAGE.upper()}",
            MessageAttributes={
                'severity': {
                    'DataType': 'String',
                    'StringValue': severity
                },
                'environment': {
                    'DataType': 'String',
                    'StringValue': STAGE
                },
                'alert_type': {
                    'DataType': 'String',
                    'StringValue': 'health_check'
                }
            }
        )
        
        logger.info(f"Health alert sent: {severity} - {message}")
        
    except Exception as e:
        logger.error(f"Error sending health alert: {str(e)}")