import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class LbPrivateMultipleEc2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create VPC with 2 AZs, public and private subnets
    const vpc = new ec2.Vpc(this, 'LbPrivateEc2Vpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public-subnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private-subnet',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // No NAT gateway
        },
      ],
    });

    // Security group for the Load Balancer
    const lbSecurityGroup = new ec2.SecurityGroup(this, 'LbSecurityGroup', {
      vpc,
      description: 'Security group for the load balancer',
      allowAllOutbound: true,
    });
    // Allow HTTP traffic from anywhere to the load balancer
    lbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );

    // Security group for EC2 instances
    const instanceSecurityGroup = new ec2.SecurityGroup(this, 'InstanceSecurityGroup', {
      vpc,
      description: 'Security group for the EC2 instances',
      allowAllOutbound: false, // No outbound access required
    });
    // Allow HTTP traffic only from the load balancer security group
    instanceSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(lbSecurityGroup.securityGroupId),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from the load balancer'
    );

    // Create an IAM role for EC2 instances
    const role = new iam.Role(this, 'EC2InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    // User data script to set up a simple web server on EC2 instances
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'yum update -y',
      'yum install -y httpd',
      'systemctl start httpd',
      'systemctl enable httpd',
      `echo '<html><head><title>Hello from EC2</title></head><body>
      <h1>Hello from EC2 Instance</h1>
      <p>Instance ID: $(curl -s http://169.254.169.254/latest/meta-data/instance-id)</p>
      <p>Availability Zone: $(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone)</p>
      <p>Private IP: $(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)</p>
      </body></html>' > /var/www/html/index.html`
    );

    // Create EC2 instances in private subnets
    const privateSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    }).subnets;

    // Instance 1
    const instance1 = new ec2.Instance(this, 'WebServer1', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2({
        cpuType: ec2.AmazonLinuxCpuType.X86_64,
      }),
      securityGroup: instanceSecurityGroup,
      vpcSubnets: {
        subnets: [privateSubnets[0]],
      },
      userData,
      role,
    });

    // Instance 2
    const instance2 = new ec2.Instance(this, 'WebServer2', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2({
        cpuType: ec2.AmazonLinuxCpuType.X86_64,
      }),
      securityGroup: instanceSecurityGroup,
      vpcSubnets: {
        subnets: [privateSubnets[1]],
      },
      userData,
      role,
    });

    // Create a load balancer in the public subnets
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'WebLoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: lbSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Create target group for the EC2 instances
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'WebTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/',
        port: '80',
        healthyHttpCodes: '200',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        timeout: Duration.seconds(10),
        interval: Duration.seconds(30),
      },
    });

    // Add the instances to the target group
    targetGroup.addTarget(instance1);
    targetGroup.addTarget(instance2);

    // Add listener to the load balancer
    const listener = loadBalancer.addListener('WebListener', {
      port: 80,
      open: true,
    });

    // Add the target group to the listener
    listener.addTargetGroups('WebTargetGroups', {
      targetGroups: [targetGroup],
    });

    // CloudWatch metrics
    // 1. Request count per target
    const requestCountMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCountPerTarget',
      dimensionsMap: {
        TargetGroup: targetGroup.targetGroupFullName,
        LoadBalancer: loadBalancer.loadBalancerFullName,
      },
      statistic: 'Sum',
      period: Duration.minutes(1),
    });

    // 2. Target response time
    const responseTimeMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'TargetResponseTime',
      dimensionsMap: {
        TargetGroup: targetGroup.targetGroupFullName,
        LoadBalancer: loadBalancer.loadBalancerFullName,
      },
      statistic: 'Average',
      period: Duration.minutes(1),
    });

    // 3. Health status
    const healthyHostCountMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'HealthyHostCount',
      dimensionsMap: {
        TargetGroup: targetGroup.targetGroupFullName,
        LoadBalancer: loadBalancer.loadBalancerFullName,
      },
      statistic: 'Average',
      period: Duration.minutes(1),
    });

    // Create an alarm for unhealthy hosts
    const healthAlarm = new cloudwatch.Alarm(this, 'HealthCheckAlarm', {
      metric: healthyHostCountMetric,
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      alarmDescription: 'Alarm if less than 1 healthy host',
    });

    // Outputs
    // 1. ALB DNS name
    new CfnOutput(this, 'LoadBalancerDNS', {
      value: `http://${loadBalancer.loadBalancerDnsName}`,
      description: 'DNS name of the load balancer',
    });

    // 2. EC2 instance private IPs
    new CfnOutput(this, 'Instance1PrivateIP', {
      value: instance1.instancePrivateIp,
      description: 'Private IP of the first EC2 instance',
    });

    new CfnOutput(this, 'Instance2PrivateIP', {
      value: instance2.instancePrivateIp,
      description: 'Private IP of the second EC2 instance',
    });
  }
}
