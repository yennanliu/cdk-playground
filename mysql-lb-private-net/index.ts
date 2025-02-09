import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class PrivateNetworkStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC with private subnets
    const vpc = new ec2.Vpc(this, 'PrivateVPC', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        }
      ],
    });

    // Create MySQL RDS instance in private subnet
    const dbInstance = new rds.DatabaseInstance(this, 'MySQLInstance', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0
      }),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: 20,
      maxAllocatedStorage: 30,
      databaseName: 'mydb',
      // Make sure to change these in production
      credentials: rds.Credentials.fromGeneratedSecret('admin'),
    });

    // Create Application Load Balancer in public subnet
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      }
    });

    // Create security group for ALB that only allows specific IP ranges
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      description: 'Security group for ALB with restricted access',
      allowAllOutbound: true,
    });

    // Add inbound rule - replace with your specific IP ranges
    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4('YOUR_IP_RANGE/32'),  // e.g., '192.168.1.0/24'
      ec2.Port.tcp(443),
      'Allow HTTPS access from specific IP range'
    );

    // Apply security group to ALB
    alb.addSecurityGroup(albSecurityGroup);

    // Output the database endpoint
    new cdk.CfnOutput(this, 'DBEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
    });

    // Output the ALB DNS name
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
    });
  }
} 