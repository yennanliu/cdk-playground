# Redis Sentinel Cluster Testing Guide

This document describes how to test the Redis Sentinel cluster functionality through the Lambda function endpoints.

## Prerequisites

- AWS CLI configured with appropriate credentials
- The Redis Sentinel stack deployed successfully
- API Gateway endpoint URL (available in CloudFormation outputs)

## Getting the API Endpoint

```bash
# Get the API Gateway endpoint URL
export API_URL=$(aws cloudformation describe-stacks --stack-name RedisSentinel1Stack --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' --output text)
```

## Available Test Endpoints

All endpoints support both GET and POST methods.

### 1. Discovery Test
Tests the ability to discover Redis instances in the cluster.

```bash
curl "${API_URL}test?action=discover"
```

Expected Output:
```json
{
  "action": "discover",
  "timestamp": "<request-id>",
  "results": {
    "discovered_instances": ["<host>:6379"],
    "test_results": [
      {
        "host": "<host>",
        "redis_port": "accessible",
        "sentinel_port": "accessible"
      }
    ],
    "discovery_method": "network_scan",
    "note": "Discovered Redis instances by testing network connectivity."
  }
}
```

### 2. Connectivity Test
Tests basic connectivity to Redis and Sentinel ports.

```bash
curl "${API_URL}test?action=test"
```

Expected Output:
```json
{
  "action": "test",
  "timestamp": "<request-id>",
  "results": {
    "connectivity_tests": [
      {
        "host": "<host>",
        "redis_port": "accessible",
        "sentinel_port": "accessible"
      }
    ],
    "test_type": "network_connectivity",
    "accessible_hosts": [
      {
        "host": "<host>",
        "redis_port": "accessible",
        "sentinel_port": "accessible"
      }
    ]
  }
}
```

### 3. Redis Operations Test
Tests basic Redis protocol operations.

```bash
curl "${API_URL}test?action=redis-ops"
```

Expected Output:
```json
{
  "action": "redis-ops",
  "timestamp": "<request-id>",
  "results": {
    "redis_operations": [
      {
        "host": "<host>",
        "status": "success",
        "ping_response": "+PONG",
        "note": "Basic Redis protocol test"
      }
    ],
    "test_type": "basic_redis_protocol"
  }
}
```

### 4. Sentinel Operations Test
Tests Redis Sentinel functionality.

```bash
curl "${API_URL}test?action=sentinel"
```

Expected Output:
```json
{
  "action": "sentinel",
  "timestamp": "<request-id>",
  "results": {
    "sentinel_operations": [
      {
        "sentinel_host": "<host>:26379",
        "status": "success",
        "masters_response": "<sentinel-masters-info>",
        "note": "Basic Sentinel protocol test"
      }
    ],
    "test_type": "basic_sentinel_protocol"
  }
}
```

### 5. System Information
Gets information about the Lambda function and Redis configuration.

```bash
curl "${API_URL}test?action=info"
```

Expected Output:
```json
{
  "action": "info",
  "timestamp": "<request-id>",
  "results": {
    "lambda_info": {
      "function_name": "<function-name>",
      "function_version": "$LATEST",
      "memory_limit": 512,
      "remaining_time": "<remaining-ms>",
      "log_group": "<log-group-name>",
      "log_stream": "<log-stream-name>"
    },
    "redis_config": {
      "master_name": "mymaster",
      "expected_replicas": 3,
      "redis_port": 6379,
      "sentinel_port": 26379
    },
    "environment": {
      "redis_master_name": "mymaster",
      "aws_region": "<region>",
      "node_version": "<version>",
      "platform": "linux"
    }
  }
}
```

## Error Handling

If an error occurs, the response will have a 500 status code and include error details:

```json
{
  "error": "Error message description",
  "action": "<attempted-action>"
}
```

## Troubleshooting

1. If discovery fails:
   - Verify ECS tasks are running
   - Check security group rules
   - Verify VPC endpoints and networking

2. If Redis operations fail:
   - Check if master node is accessible
   - Verify Redis port (6379) is open
   - Check ECS task logs for Redis errors

3. If Sentinel operations fail:
   - Verify Sentinel port (26379) is accessible
   - Check Sentinel quorum status
   - Review Sentinel configuration

4. Common Issues:
   - Network connectivity: Check VPC, security groups, and subnets
   - DNS resolution: Verify service discovery is working
   - Port accessibility: Confirm security group rules allow traffic
   - Task health: Check ECS task status and container logs

## Monitoring

To monitor the Lambda function and Redis cluster:

1. CloudWatch Logs:
   - Check Lambda function logs
   - Review ECS container logs

2. CloudWatch Metrics:
   - Lambda execution metrics
   - ECS task metrics
   - Redis connectivity metrics

3. X-Ray Tracing (if enabled):
   - Trace Lambda invocations
   - Monitor Redis operations
   - Track network latency

## Support

For issues or questions:
1. Check CloudWatch Logs for detailed error messages
2. Review ECS task definitions and container logs
3. Verify network configuration and security groups
4. Check Lambda function configuration and permissions
