# Private Network EC2 CDK Stack

This AWS CDK project deploys a VPC with public and private subnets, along with two EC2 instances:
- A public EC2 instance that serves as a bastion host
- A private EC2 instance that is only accessible via the bastion host

## Architecture

![Architecture Diagram](architecture-diagram.png)

The architecture includes:

1. **VPC** with both public and private subnets across 2 availability zones
2. **Internet Gateway** for public subnet traffic
3. **NAT Gateway** allowing private instances to access the internet
4. **Public EC2 Instance** with SSH access from the internet
5. **Private EC2 Instance** with no public IP, only accessible via the bastion host
6. **Security Groups** controlling access between instances

## Prerequisites

- AWS CDK installed and configured
- Node.js and npm
- AWS CLI installed and configured with credentials
- An EC2 key pair to SSH into the instances

## Deployment

1. Install the required dependencies:
```
npm install
```

2. Build the project:
```
npm run build
```

3. Deploy the stack:
```
cdk deploy --parameters KeyName=YOUR-KEY-PAIR-NAME
```

Replace `YOUR-KEY-PAIR-NAME` with an existing EC2 key pair name.

## Connecting to the Instances

1. First, SSH into the public instance (bastion host):
```
ssh -i /path/to/your-key.pem ec2-user@<PublicInstanceIP>
```

2. Then, from the bastion host, SSH into the private instance:
```
ssh -i ~/.ssh/id_rsa ec2-user@<PrivateInstanceIP>
```

Note: You'll need to securely copy your private key to the bastion host or use SSH agent forwarding.

## Clean up

To avoid incurring charges, remove all resources when no longer needed:

```
cdk destroy
```

## Security Considerations

- The public instance is accessible via SSH from anywhere (0.0.0.0/0)
- The private instance only allows SSH connections from the public instance's security group
- Both instances use the same key pair for SSH access
- The private instance has outbound internet access through the NAT Gateway
