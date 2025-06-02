# Redis Sentinel CDK Stack

This CDK stack deploys a Redis Sentinel cluster on AWS ECS Fargate with a TypeScript Lambda function for testing the setup.

## Quick Start

```bash
npm install
npx tsc -p tsconfig.lambda.json
cdk bootstrap
cdk deploy
```

## Architecture

- **ECS Fargate Service**: 3 replicas running Redis with Sentinel
- **VPC**: Custom VPC with public and private subnets
- **Lambda Function**: TypeScript function to test Redis Sentinel connectivity
- **API Gateway**: REST API to invoke the Lambda test function
- **Security Groups**: Properly configured for Redis (6379) and Sentinel (26379) ports

## Project Structure

```
├── lib/
│   └── redis-sentinel-1-stack.ts       # Main CDK stack
├── lambda/
│   ├── index.ts                         # TypeScript Lambda function
│   └── package.json                     # Lambda dependencies
├── tsconfig.lambda.json                 # TypeScript config for Lambda
├── requirements.txt                     # Python dependencies (legacy)
└── README.md                           # This file
```

## Prerequisites

- AWS CDK v2 installed
- Node.js 18+ installed
- AWS CLI configured
- Appropriate AWS permissions

## Deployment

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Compile Lambda TypeScript**:
   ```bash
   npx tsc -p tsconfig.lambda.json
   ```

3. **Bootstrap CDK** (if first time):
   ```bash
   cdk bootstrap
   ```

4. **Deploy the stack**:
   ```bash
   cdk deploy
   ```

## Testing the Redis Sentinel Cluster

After deployment, you'll get several outputs including API endpoints. The Lambda function provides multiple test actions:

### Available Test Actions

1. **Basic Connectivity Test**:
   ```bash
   curl "https://YOUR_API_GATEWAY_URL/test?action=test"
   ```

2. **Discover Redis Instances**:
   ```bash
   curl "https://YOUR_API_GATEWAY_URL/test?action=discover"
   ```

3. **Redis Operations Test**:
   ```bash
   curl "https://YOUR_API_GATEWAY_URL/test?action=redis-ops"
   ```

4. **Sentinel Operations Test**:
   ```bash
   curl "https://YOUR_API_GATEWAY_URL/test?action=sentinel"
   ```

5. **System Information**:
   ```bash
   curl "https://YOUR_API_GATEWAY_URL/test?action=info"
   ```

### Example Response

```json
{
  "action": "test",
  "timestamp": "request-id-12345",
  "results": {
    "connectivity_tests": [
      {
        "host": "10.0.1.100",
        "redis_port": "accessible",
        "sentinel_port": "accessible"
      }
    ],
    "test_type": "network_connectivity",
    "note": "Basic network connectivity test to Redis and Sentinel ports"
  }
}
```

## Lambda Function Features

The TypeScript Lambda function provides:

- **Network connectivity testing** to Redis and Sentinel ports
- **Basic Redis protocol testing** (PING commands)
- **Sentinel discovery** using basic protocol commands
- **Comprehensive error handling** and logging
- **Type safety** with TypeScript interfaces

## Configuration

### Redis Sentinel Configuration

The Redis containers are configured with:
- Master name: `mymaster`
- Quorum: 2 (requires 2 Sentinels to agree on failover)
- Down after: 5000ms
- Failover timeout: 60000ms

### Lambda Configuration

- Runtime: Node.js 18.x
- Memory: 512 MB
- Timeout: 30 seconds
- VPC: Deployed in private subnets with NAT gateway access

## Adding Full Redis Operations

To add full Redis operations (SET, GET, DELETE), you can:

1. **Install Redis in Lambda**:
   ```bash
   cd lambda
   npm install redis
   cd ..
   ```

2. **Update the CDK bundling**:
   ```typescript
   bundling: {
     nodeModules: ["redis"],
     // ... other options
   }
   ```

3. **Use the Redis client** in `lambda/index.ts`:
   ```typescript
   import * as Redis from 'redis';
   const client = Redis.createClient({ ... });
   ```

## Production Considerations

1. **Service Discovery**: Replace hardcoded IPs with AWS ECS Service Discovery or CloudMap
2. **Security**: 
   - Remove public IP assignment from ECS tasks
   - Use Application Load Balancer for Redis access
   - Implement proper IAM roles and policies
3. **Monitoring**: Add CloudWatch dashboards and alarms
4. **Backup**: Implement Redis backup strategy
5. **SSL/TLS**: Enable encryption in transit and at rest

## Troubleshooting

### Common Issues

1. **Lambda timeout**: Check VPC configuration and NAT gateway
2. **Connection refused**: Verify security groups and ECS task status
3. **Service discovery**: Tasks might take time to become healthy
4. **TypeScript compilation errors**: Run `npx tsc -p tsconfig.lambda.json` to check for errors

### Debugging

- Check ECS service logs in CloudWatch
- Monitor Lambda logs for connection errors
- Verify security group rules

## Build Commands

- `npm run build` - Compile CDK TypeScript
- `npm run build:lambda` - Compile Lambda TypeScript
- `npx tsc -p tsconfig.lambda.json` - Compile Lambda directly

## Cleanup

To destroy the stack:

```bash
cdk destroy
```

## Cost Considerations

This stack will incur costs for:
- ECS Fargate tasks (3 replicas)
- NAT Gateway
- Lambda executions
- API Gateway requests
- CloudWatch logs

## Contributing

1. Make changes to the TypeScript files
2. Test locally if possible
3. Deploy to a test environment
4. Submit pull request with detailed description

## License

This project is licensed under the MIT License.

⸻

🧱 High-Level Architecture for Redis Sentinel on AWS via CDK

📦 Components:
	1.	VPC
	•	Custom VPC with private and public subnets.
	•	Subnet groups for Redis cluster nodes and Sentinel nodes.
	2.	EC2 Instances (Redis Nodes)
	•	At least 3 EC2 instances: 1 master, 2 replicas.
	•	Running Redis in cluster/sentinel-aware configuration.
	•	Security groups for inter-node communication.
	3.	EC2 Instances (Sentinel Nodes)
	•	3 additional EC2 instances running only Redis Sentinel.
	•	Monitors the Redis master and triggers failover if necessary.
	4.	Security Groups
	•	Allow TCP ports:
	•	6379 (Redis)
	•	26379 (Sentinel)
	•	Intra-node communication only (within a Redis security group)
	5.	Auto Scaling Group (Optional)
	•	For replicas/sentinel for resilience.
	•	Attach health checks.
	6.	Elastic IP (Optional)
	•	Or use AWS internal DNS with EC2 instance discovery for Sentinel nodes.
	7.	UserData / Scripts
	•	Provision EC2 nodes with:
	•	Redis install
	•	Sentinel config generation
	•	Proper replication setup (slaveof, sentinel monitor, etc.)

⸻

🧰 Tools and AWS Services Used

AWS Service	Purpose
EC2	Hosts Redis + Sentinel services
CDK (EC2, VPC, IAM, SG)	Infrastructure as code
IAM Roles	Permissions for EC2 to read configs from S3 if needed
VPC/Subnets	Isolation between Redis and Sentinel nodes
S3 (optional)	For shared config files/scripts
CloudWatch Logs	Log Redis and Sentinel output for monitoring


⸻

📐 Architecture Diagram (Conceptual)

                        ┌─────────────────────────────┐
                        │         AWS VPC             │
                        │                             │
                        │ ┌────────────┐              │
                        │ │  Redis EC2 │ ← Master     │
                        │ └────────────┘              │
                        │     ▲       ▲               │
                        │     │       │               │
                        │ ┌────────────┐              │
                        │ │  Redis EC2 │ ← Replica    │
                        │ └────────────┘              │
                        │ ┌────────────┐              │
                        │ │  Redis EC2 │ ← Replica    │
                        │ └────────────┘              │
                        │                             │
                        │ ┌────────────┐              │
                        │ │ Sentinel   │ ← Watches    │
                        │ └────────────┘              │
                        │ ┌────────────┐              │
                        │ │ Sentinel   │ ← Watches    │
                        │ └────────────┘              │
                        │ ┌────────────┐              │
                        │ │ Sentinel   │ ← Watches    │
                        │ └────────────┘              │
                        └─────────────────────────────┘


⸻

✅ Benefits
	•	High Availability: Redis Sentinel ensures automatic failover if the master goes down.
	•	Infrastructure-as-Code: CDK maintains reproducibility and version control.
	•	Customizability: You can easily increase the number of replicas/sentinels.
	•	Network Isolation: Redis and Sentinel nodes can be restricted with fine-grained security groups.

⸻
