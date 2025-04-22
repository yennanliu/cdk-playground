import { CfnOutput, CfnParameter, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class PrivateNetworkEc2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a parameter for the key pair name
    const keyNameParam = new CfnParameter(this, 'KeyName', {
      type: 'String',
      description: 'Name of an existing EC2 KeyPair to enable SSH access to the instances',
      default: 'private-network-key',
    });

    // 1. Create a VPC with public and private subnets in 2 AZs
    const vpc = new ec2.Vpc(this, 'PrivateNetworkVPC', {
      maxAzs: 2,
      natGateways: 1, // Add NAT Gateway for private subnets to access internet
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        }
      ],
    });

    // 2. Create Security Groups
    // Security group for public EC2 instance (bastion host)
    const publicSecurityGroup = new ec2.SecurityGroup(this, 'PublicSecurityGroup', {
      vpc,
      description: 'Security group for public EC2 instance',
      allowAllOutbound: true,
    });

    // Allow SSH access from anywhere (Internet) to public instance
    publicSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access from Internet'
    );

    // Security group for private EC2 instance
    const privateSecurityGroup = new ec2.SecurityGroup(this, 'PrivateSecurityGroup', {
      vpc,
      description: 'Security group for private EC2 instance',
      allowAllOutbound: true,
    });

    // Allow SSH access to private instance only from the public security group
    privateSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(publicSecurityGroup.securityGroupId),
      ec2.Port.tcp(22),
      'Allow SSH access from public EC2 instance'
    );

    // 3. Use key pair parameter instead of hardcoded value
    const keyName = keyNameParam.valueAsString;

    // 4. Create Public EC2 Instance (bastion host)
    const publicInstance = new ec2.Instance(this, 'PublicEC2Instance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup: publicSecurityGroup,
      keyName: keyName,
    });

    // 5. Create Private EC2 Instance
    const privateInstance = new ec2.Instance(this, 'PrivateEC2Instance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup: privateSecurityGroup,
      keyName: keyName,
    });

    // Add bootstrap user data to install packages
    privateInstance.addUserData(
      'echo "Hello from Private EC2 Instance" > /home/ec2-user/hello.txt',
      'yum update -y',
      'yum install -y httpd',
      'systemctl start httpd',
      'systemctl enable httpd'
    );

    publicInstance.addUserData(
      'echo "Hello from Public EC2 Instance" > /home/ec2-user/hello.txt',
      'yum update -y'
    );

    // 6. Output the necessary information
    new CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new CfnOutput(this, 'PublicInstanceIP', {
      value: publicInstance.instancePublicIp,
      description: 'Public IP address of the public EC2 instance',
    });

    new CfnOutput(this, 'PrivateInstanceIP', {
      value: privateInstance.instancePrivateIp,
      description: 'Private IP address of the private EC2 instance',
    });
  }
}
