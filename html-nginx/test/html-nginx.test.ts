import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as HtmlNginx from '../lib/html-nginx-stack';

describe('HtmlNginxStack', () => {
  let app: cdk.App;
  let stack: HtmlNginx.HtmlNginxStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new HtmlNginx.HtmlNginxStack(app, 'TestHtmlNginxStack');
    template = Template.fromStack(stack);
  });

  test('VPC Created', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::EC2::Subnet', 4); // 2 public + 2 isolated subnets
    template.resourceCountIs('AWS::EC2::InternetGateway', 1);
  });

  test('Security Group Created', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Allow HTTP access to web servers',
      SecurityGroupIngress: [
        {
          CidrIp: '0.0.0.0/0',
          Description: 'Allow HTTP access from anywhere',
          FromPort: 80,
          IpProtocol: 'tcp',
          ToPort: 80
        }
      ]
    });
  });

  test('IAM Role Created', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'ec2.amazonaws.com'
            }
          }
        ]
      }
    });
  });

  test('AutoScaling Group Created', () => {
    template.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 1);
    template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      MinSize: '2',
      MaxSize: '4',
      DesiredCapacity: '2'
    });
  });

  test('EC2 Launch Configuration Created', () => {
    template.resourceCountIs('AWS::AutoScaling::LaunchConfiguration', 1);
    template.hasResourceProperties('AWS::AutoScaling::LaunchConfiguration', {
      InstanceType: 't2.micro'
    });
  });

  test('Load Balancer Created', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application'
    });
  });

  test('Load Balancer Listener Created', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP'
    });
  });

  test('Output Created', () => {
    template.hasOutput('LoadBalancerURL', {});
  });
});
