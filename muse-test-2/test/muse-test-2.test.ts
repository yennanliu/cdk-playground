import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { MuseTest2Stack, MuseTest2StackProps, bedrockInvoke } from '../lib/muse-test-2-stack';

const ENV = { account: '123456789012', region: 'ap-northeast-1' };

function synth(props: Partial<MuseTest2StackProps> = {}) {
  const stack = new MuseTest2Stack(new cdk.App(), 'TestStack', { env: ENV, ...props });
  return { stack, template: Template.fromStack(stack) };
}

/** Renders `Fn::Join` values to plain strings, substituting the `aws` partition. */
function render(value: any): string {
  if (typeof value === 'string') return value;
  if (value?.Ref === 'AWS::Partition') return 'aws';
  if (value?.['Fn::Join']) return value['Fn::Join'][1].map(render).join('');
  return JSON.stringify(value);
}

function only(template: Template, type: string): any {
  const resources = Object.values(template.findResources(type));
  expect(resources).toHaveLength(1);
  return resources[0];
}

function userData(template: Template): string {
  return render(only(template, 'AWS::EC2::Instance').Properties.UserData['Fn::Base64']);
}

function statements(template: Template): any[] {
  return Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
    (p: any) => p.Properties.PolicyDocument.Statement,
  );
}

function appAssetHash(template: Template): string {
  const url = render(only(template, 'AWS::SSM::Parameter').Properties.Value);
  return url.match(/([0-9a-f]{64})\.zip$/)![1];
}

describe('network', () => {
  test('one public subnet, no NAT gateway', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::EC2::Subnet', 1);
  });

  test('security group has no ingress at all', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('no inbound'),
      SecurityGroupIngress: Match.absent(),
    });
    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
  });
});

describe('instance', () => {
  test('t3.large by default, configurable', () => {
    synth().template.hasResourceProperties('AWS::EC2::Instance', { InstanceType: 't3.large' });
    synth({ instanceType: ec2.InstanceType.of(ec2.InstanceClass.M7I, ec2.InstanceSize.XLARGE) })
      .template.hasResourceProperties('AWS::EC2::Instance', { InstanceType: 'm7i.xlarge' });
  });

  test('encrypted gp3 root volume', () => {
    synth().template.hasResourceProperties('AWS::EC2::Instance', {
      BlockDeviceMappings: [Match.objectLike({ Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3', VolumeSize: 40 }) })],
    });
  });

  test('IMDSv2 only, with a hop limit containers can use', () => {
    synth().template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: { MetadataOptions: { HttpTokens: 'required', HttpPutResponseHopLimit: 2 } },
    });
  });

  test('user data writes the config and runs the bootstrap', () => {
    const script = userData(synth({ allowedDomains: ['wikipedia.org', 'example.com'] }).template);
    expect(script).toContain('MUSE_MODEL_ID=global.anthropic.claude-sonnet-5-5');
    expect(script).toContain('MUSE_EMBED_MODEL_ID=amazon.titan-embed-text-v2:0');
    expect(script).toContain('MUSE_ALLOWED_DOMAINS=wikipedia.org,example.com');
    expect(script).toContain('MUSE_APP_PARAM=/TestStack/app-zip');
    expect(script).toContain('/opt/muse/bootstrap.sh');
  });

  test('an app release does not change user data, so it never replaces the box', () => {
    const { template } = synth();
    expect(userData(template)).not.toContain(appAssetHash(template));
  });
});

describe('release', () => {
  test('the app zip location is published to SSM', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::SSM::Parameter', { Name: '/TestStack/app-zip', Type: 'String' });
    expect(render(only(template, 'AWS::SSM::Parameter').Properties.Value)).toMatch(/^s3:\/\/.+\.zip$/);
  });

  test('a new app version triggers muse-release on the box over SSM', () => {
    const { template } = synth();
    const release = only(template, 'Custom::AWS');
    const update = render(release.Properties.Update);
    expect(update).toContain('"action":"sendCommand"');
    expect(update).toContain('/usr/local/bin/muse-release');
    expect(update).toContain(appAssetHash(template));
    expect(update).toContain('InvalidInstanceId'); // a box still booting releases itself
    expect(render(release.Properties.Create)).toContain('"action":"getParameter"');
  });

  test('release waits for the new parameter value and the new IAM policy', () => {
    const { template } = synth();
    const deps: string[] = only(template, 'Custom::AWS').DependsOn;
    expect(deps.some((d) => d.startsWith('AppZip'))).toBe(true);
    expect(deps.some((d) => d.startsWith('InstanceRoleDefaultPolicy'))).toBe(true);
  });
});

describe('permissions', () => {
  test('instance can invoke exactly the chat model and the embedding model', () => {
    const bedrock = statements(synth().template).filter((s) => [s.Action].flat().includes('bedrock:InvokeModel'));
    expect(bedrock.flatMap((s) => s.Resource.map(render)).sort()).toEqual([
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-5-5',
      'arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0',
      'arn:aws:bedrock:ap-northeast-1:123456789012:inference-profile/global.anthropic.claude-sonnet-5-5',
    ].sort());
  });

  test('instance can read the app parameter', () => {
    const read = statements(synth().template).find((s) => [s.Action].flat().includes('ssm:GetParameter'));
    expect(read).toBeDefined();
  });

  test('no IAM statement grants a wildcard action', () => {
    for (const s of statements(synth().template)) expect([s.Action].flat()).not.toContain('*');
  });
});

describe('bedrockInvoke', () => {
  const stack = new cdk.Stack(new cdk.App(), 'S', { env: ENV });
  const resources = (id: string) => stack.resolve(bedrockInvoke(stack, id).resources).map(render);

  test('inference profile grants the profile and its foundation model in any region', () => {
    expect(resources('jp.anthropic.claude-haiku-5-5')).toEqual([
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5',
      'arn:aws:bedrock:ap-northeast-1:123456789012:inference-profile/jp.anthropic.claude-haiku-5-5',
    ]);
  });

  test('bare model ID grants only the foundation model', () => {
    expect(resources('amazon.titan-embed-text-v2:0')).toEqual([
      'arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0',
    ]);
  });
});

test('outputs the tunnel and release commands', () => {
  const { template } = synth();
  template.hasOutput('InstanceId', {});
  expect(render(template.findOutputs('TunnelCommand').TunnelCommand.Value)).toContain('AWS-StartPortForwardingSession');
  expect(render(template.findOutputs('ReleaseCommand').ReleaseCommand.Value)).toContain('muse-release');
});

test('synthesizes without errors or warnings', () => {
  // A fresh stack, synthesized once: a second synth re-runs the IMDSv2 aspect and warns spuriously.
  const annotations = Annotations.fromStack(new MuseTest2Stack(new cdk.App(), 'TestStack', { env: ENV }));
  expect(annotations.findError('*', Match.anyValue())).toEqual([]);
  expect(annotations.findWarning('*', Match.anyValue())).toEqual([]);
});
