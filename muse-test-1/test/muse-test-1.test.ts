import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { MuseTest1Stack, MuseTest1StackProps, bedrockInvoke } from '../lib/muse-test-1-stack';

const ENV = { account: '123456789012', region: 'ap-northeast-1' };

function synth(props: Partial<MuseTest1StackProps> = {}) {
  const app = new cdk.App();
  const stack = new MuseTest1Stack(app, 'TestStack', { env: ENV, ...props });
  return { stack, template: Template.fromStack(stack) };
}

/** Renders `Fn::Join` ARNs to plain strings, substituting the `aws` partition. */
function render(value: any): string {
  if (typeof value === 'string') return value;
  return value['Fn::Join'][1].map((part: any) => (typeof part === 'string' ? part : part.Ref === 'AWS::Partition' ? 'aws' : '?')).join('');
}

function bedrockResources(template: Template): string[] {
  for (const policy of Object.values(template.findResources('AWS::IAM::Policy')) as any[]) {
    for (const statement of policy.Properties.PolicyDocument.Statement) {
      if ([statement.Action].flat().includes('bedrock:InvokeModel')) return statement.Resource.map(render);
    }
  }
  throw new Error('no bedrock statement');
}

function userData(template: Template): string {
  const [instance] = Object.values(template.findResources('AWS::EC2::Instance')) as any[];
  return JSON.stringify(instance.Properties.UserData);
}

describe('network', () => {
  test('one public subnet and no NAT gateway (the box needs egress only)', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::EC2::Subnet', 1);
    template.hasResourceProperties('AWS::EC2::Subnet', { MapPublicIpOnLaunch: true });
  });

  test('security group has no ingress rules at all', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.absent(),
      SecurityGroupEgress: [Match.objectLike({ CidrIp: '0.0.0.0/0' })],
    });
    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
  });
});

describe('instance', () => {
  test('single Amazon Linux 2023 instance, t3.medium by default', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::EC2::Instance', 1);
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't3.medium',
      ImageId: { Ref: Match.stringLikeRegexp('al2023') },
    });
  });

  test('instance type is configurable', () => {
    const { template } = synth({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
    });
    template.hasResourceProperties('AWS::EC2::Instance', { InstanceType: 't3.large' });
  });

  test('encrypted gp3 root volume', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::EC2::Instance', {
      BlockDeviceMappings: [
        Match.objectLike({
          DeviceName: '/dev/xvda',
          Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3', VolumeSize: 30 }),
        }),
      ],
    });
  });

  test('requires IMDSv2', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: { MetadataOptions: { HttpTokens: 'required' } },
    });
  });

  test('user data writes the config and runs the bootstrap', () => {
    const { template } = synth({ allowedDomains: ['wikipedia.org', 'news.ycombinator.com'] });
    const script = userData(template);
    expect(script).toContain('MUSE_MODEL_ID=global.anthropic.claude-sonnet-5-5');
    expect(script).toContain('MUSE_ALLOWED_DOMAINS=wikipedia.org,news.ycombinator.com');
    expect(script).toContain('/etc/muse/muse.env');
    expect(script).toContain('/opt/muse/bootstrap.sh');
  });

  test('model is configurable', () => {
    const { template } = synth({ bedrockModelId: 'jp.anthropic.claude-haiku-5-5' });
    expect(userData(template)).toContain('MUSE_MODEL_ID=jp.anthropic.claude-haiku-5-5');
  });
});

describe('permissions', () => {
  test('instance role can use SSM Session Manager', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({ 'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp('AmazonSSMManagedInstanceCore')])]) }),
      ]),
    });
  });

  test('instance role can invoke exactly the configured model', () => {
    expect(bedrockResources(synth().template)).toEqual([
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-5-5',
      'arn:aws:bedrock:ap-northeast-1:123456789012:inference-profile/global.anthropic.claude-sonnet-5-5',
    ]);
  });

  test('no IAM statement grants a wildcard action', () => {
    const { template } = synth();
    for (const policy of Object.values(template.findResources('AWS::IAM::Policy')) as any[]) {
      for (const statement of policy.Properties.PolicyDocument.Statement) {
        expect([statement.Action].flat()).not.toContain('*');
      }
    }
  });
});

describe('bedrockInvoke', () => {
  const stack = new cdk.Stack(new cdk.App(), 'S', { env: ENV });

  test('inference profile grants the profile and the foundation model in any region', () => {
    const resources = stack.resolve(bedrockInvoke(stack, 'jp.anthropic.claude-haiku-5-5').resources).map(render);
    expect(resources).toEqual([
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5',
      'arn:aws:bedrock:ap-northeast-1:123456789012:inference-profile/jp.anthropic.claude-haiku-5-5',
    ]);
  });

  test('bare model ID grants only the foundation model', () => {
    const resources = stack.resolve(bedrockInvoke(stack, 'anthropic.claude-haiku-5-5').resources).map(render);
    expect(resources).toEqual(['arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5']);
  });
});

test('outputs the tunnel command used to reach the UI', () => {
  const { template } = synth();
  template.hasOutput('TunnelCommand', {
    Value: Match.objectLike({ 'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp('AWS-StartPortForwardingSession')])]) }),
  });
  template.hasOutput('InstanceId', {});
});

test('synthesizes without errors or warnings', () => {
  // A fresh stack: synthesizing twice re-runs the IMDSv2 aspect and warns spuriously.
  const stack = new MuseTest1Stack(new cdk.App(), 'TestStack', { env: ENV });
  const annotations = Annotations.fromStack(stack);
  expect(annotations.findError('*', Match.anyValue())).toEqual([]);
  expect(annotations.findWarning('*', Match.anyValue())).toEqual([]);
});
