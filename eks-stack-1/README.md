# EKS Stack with CDK

This project implements a simple yet production-ready Amazon EKS cluster using AWS CDK in TypeScript. The design prioritizes security, cost-efficiency, and operational simplicity.

## Architecture Overview

The stack creates an EKS cluster with the following components:

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                        AWS Region                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                      VPC                                ││
│  │                                                         ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     ││
│  │  │   AZ-1a     │  │   AZ-1b     │  │   AZ-1c     │     ││
│  │  │             │  │             │  │             │     ││
│  │  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │     ││
│  │  │ │ Public  │ │  │ │ Public  │ │  │ │ Public  │ │     ││
│  │  │ │ Subnet  │ │  │ │ Subnet  │ │  │ │ Subnet  │ │     ││
│  │  │ │   ALB   │ │  │ │  NAT-GW │ │  │ │         │ │     ││
│  │  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │     ││
│  │  │             │  │             │  │             │     ││
│  │  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │     ││
│  │  │ │ Private │ │  │ │ Private │ │  │ │ Private │ │     ││
│  │  │ │ Subnet  │ │  │ │ Subnet  │ │  │ │ Subnet  │ │     ││
│  │  │ │EKS Nodes│ │  │ │EKS Nodes│ │  │ │EKS Nodes│ │     ││
│  │  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │     ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              EKS Control Plane                          ││
│  │                (AWS Managed)                            ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  External Services:                                         │
│  • CloudWatch (Logs & Metrics)                             │
│  • Load Balancer Controller                                 │
└─────────────────────────────────────────────────────────────┘

                Internet Gateway ↕ (Traffic Flow)
```

### Network Layer
- VPC across 3 Availability Zones
- Public subnets for ALB and NAT Gateway
- Private subnets for EKS worker nodes
- Single NAT Gateway (cost-optimized)
- Internet Gateway for public access

### EKS Configuration
- Managed EKS control plane (v1.31)
- EC2 managed node groups
- t3.medium instances (cost-effective)
- Auto Scaling Group (1-5 nodes)
- Private endpoint with restricted public access

### Load Balancing
- Application Load Balancer in public subnets
- AWS Load Balancer Controller for Kubernetes integration

### Monitoring & Logging
- CloudWatch Container Insights
- VPC Flow Logs
- Control plane logging
- CloudWatch alarms for cluster metrics

### Security
- IAM roles with least privilege
- Security groups with minimal required ports
- VPC network isolation
- Private subnets for worker nodes

## Prerequisites

1. AWS CDK CLI installed
```bash
npm install -g aws-cdk
```

2. AWS credentials configured
```bash
aws configure
```

3. Node.js and npm installed

## Installation

1. Clone the repository
```bash
git clone <repository-url>
cd eks-stack-1
```

2. Install dependencies
```bash
npm install
```

## Deployment

1. Bootstrap your AWS environment (if not already done):
```bash
cdk bootstrap
```

2. Deploy the stack:
```bash
cdk deploy
```

3. After deployment, configure kubectl:
```bash
# The command will be provided in the stack outputs
aws eks update-kubeconfig --region <your-region> --name <cluster-name>
```

## Cost Optimization

The stack implements several cost-saving measures:

- Single NAT Gateway (~$45/month savings)
- t3.medium instances (good price/performance ratio)
- Autoscaling (1-5 nodes)
- CloudWatch log retention policies
- Option to use Spot Instances (modify `capacityType` in stack)

Estimated monthly cost (us-east-1):
- EKS Control Plane: $73
- 3 x t3.medium (24/7): ~$75
- ALB: ~$18
- NAT Gateway: ~$45
- Data Transfer: ~$10
- CloudWatch Logs: ~$5
Total: ~$230/month

## Security Considerations

1. Network Security
   - VPC isolation
   - Private subnets for worker nodes
   - Restricted public endpoint access
   - VPC Flow Logs enabled

2. Access Control
   - IAM roles with least privilege
   - RBAC enabled
   - Security groups with minimal ports

3. Monitoring
   - CloudWatch Container Insights
   - Control plane logging
   - VPC Flow Logs
   - CPU utilization alarms

## Useful Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

## Limitations and Considerations

1. Single NAT Gateway
   - Cost-effective but reduces availability
   - Consider multiple NAT Gateways for production

2. Public Endpoint Access
   - Currently allows all IPs (0.0.0.0/0)
   - Restrict to specific IPs in production

3. Node Instance Type
   - t3.medium is cost-effective but may not suit all workloads
   - Adjust based on your application requirements

## Future Enhancements

1. Multi-AZ NAT Gateways for high availability
2. Spot Instance support for cost savings
3. Node group diversification
4. Additional monitoring and alerting
5. Backup and disaster recovery setup