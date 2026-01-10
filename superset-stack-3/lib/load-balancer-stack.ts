import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { LoadBalancerProps } from './types';

export class LoadBalancerStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly albDnsName: string;

  constructor(scope: Construct, id: string, props: LoadBalancerProps) {
    super(scope, id);

    const albSecurityGroup = this.createAlbSecurityGroup(props.vpc, props.ecsSecurityGroup);
    this.alb = this.createLoadBalancer(props.vpc, albSecurityGroup);
    const targetGroup = this.createTargetGroup(props.vpc);
    
    // Attach services to target group
    props.services.forEach(service => {
      service.attachToApplicationTargetGroup(targetGroup);
    });

    this.createListener(targetGroup);
    this.albDnsName = this.alb.loadBalancerDnsName;
  }

  private createAlbSecurityGroup(vpc: ec2.Vpc, ecsSecurityGroup: ec2.SecurityGroup): ec2.SecurityGroup {
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Security group for Application Load Balancer',
    });

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from internet'
    );

    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(8088),
      'Allow ALB to connect to ECS service'
    );

    return albSecurityGroup;
  }

  private createLoadBalancer(vpc: ec2.Vpc, securityGroup: ec2.SecurityGroup): elbv2.ApplicationLoadBalancer {
    return new elbv2.ApplicationLoadBalancer(this, 'SupersetALB', {
      vpc,
      internetFacing: true,
      securityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });
  }

  private createTargetGroup(vpc: ec2.Vpc): elbv2.ApplicationTargetGroup {
    return new elbv2.ApplicationTargetGroup(this, 'SupersetTargetGroup', {
      vpc,
      port: 8088,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        protocol: elbv2.Protocol.HTTP,
      },
    });
  }

  private createListener(targetGroup: elbv2.ApplicationTargetGroup): void {
    this.alb.addListener('SupersetListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });
  }
}
