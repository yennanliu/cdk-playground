# Load Balancer with Private EC2 Instances

This AWS CDK project sets up a secure and scalable environment with a public-facing Application Load Balancer directing traffic to EC2 instances in private subnets.

## Architecture

This stack creates:

1. **VPC** with:
   - Spans 2 Availability Zones
   - Public and private subnets
   - Internet Gateway for public subnets

2. **EC2 Instances**:
   - Two Amazon Linux 2 instances in private subnets
   - No public IPs
   - Basic HTTP service (Apache) on port 80
   - Security group allowing traffic only from the Load Balancer

3. **Application Load Balancer**:
   - Deployed in public subnets
   - Internet-facing on port 80
   - Target group with health checks for EC2 instances

4. **CloudWatch Monitoring**:
   - HTTP request count metrics
   - Target response time metrics
   - Health status metrics and alarm

## Useful CDK Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

## Deployment

To deploy the stack:

```bash
# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Deploy the stack
cdk deploy
```

## Outputs

After deployment, the stack will output:
- ALB DNS name (accessible over the internet)
- Private IPs of the EC2 instances

## Security

- EC2 instances are in private subnets without direct internet access
- Security groups are configured to only allow necessary traffic
- SSM Session Manager access is enabled for secure instance management
