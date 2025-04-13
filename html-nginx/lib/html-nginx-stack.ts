import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as assets from 'aws-cdk-lib/aws-s3-assets';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import * as path from 'path';

export class HtmlNginxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'WebsiteVPC', {
      maxAzs: 2,
      natGateways: 0, // To save costs, we won't use NAT gateways
    });

    // Create a security group for the web server
    const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc,
      description: 'Allow HTTP access to web servers',
      allowAllOutbound: true,
    });
    webSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP access from anywhere');

    // Create a role for the instances
    const webServerRole = new iam.Role(this, 'WebServerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    webServerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    
    // Upload website content to S3
    const websiteAsset = new assets.Asset(this, 'WebsiteContent', {
      path: path.join(__dirname, '../website'),
    });
    
    // Create nginx.conf as an asset
    const nginxConfigAsset = new assets.Asset(this, 'NginxConfig', {
      path: path.join(__dirname, '../website/nginx.conf'),
    });

    // Create user data for EC2 instances
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'yum update -y',
      'amazon-linux-extras install nginx1 -y',
      'yum install -y aws-cli',
      // Create directories
      'mkdir -p /var/www/html',
      // Download website files from S3
      `aws s3 cp ${websiteAsset.s3ObjectUrl} /tmp/website.zip`,
      'cd /var/www/html && unzip /tmp/website.zip',
      // Download Nginx config
      `aws s3 cp ${nginxConfigAsset.s3ObjectUrl} /etc/nginx/nginx.conf`,
      // Set proper permissions
      'chmod -R 755 /var/www/html',
      'chown -R nginx:nginx /var/www/html',
      // Start Nginx
      'systemctl start nginx',
      'systemctl enable nginx'
    );

    // Create auto scaling group
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'WebServerASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2({
        cpuType: ec2.AmazonLinuxCpuType.X86_64,
      }),
      securityGroup: webSecurityGroup,
      userData,
      role: webServerRole,
      minCapacity: 2,
      maxCapacity: 4,
      desiredCapacity: 2,
    });

    // Grant read access to S3 assets
    websiteAsset.grantRead(autoScalingGroup.role);
    nginxConfigAsset.grantRead(autoScalingGroup.role);

    // Create application load balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'WebLoadBalancer', {
      vpc,
      internetFacing: true,
    });

    // Create listener and target group
    const listener = alb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    listener.addTargets('WebTargetGroup', {
      port: 80,
      targets: [autoScalingGroup],
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(5),
      },
    });

    // Output the load balancer URL
    new cdk.CfnOutput(this, 'LoadBalancerURL', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'URL of the load balancer',
    });
  }
}
