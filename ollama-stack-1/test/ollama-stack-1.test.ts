import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as OllamaStack1 from '../lib/ollama-stack-1-stack';

function synth() {
  const app = new cdk.App();
  const stack = new OllamaStack1.OllamaStack1Stack(app, 'MyTestStack', {
    // Vpc.fromLookup needs a concrete env; also feeds dummy VPC context.
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

test('creates a single EC2 instance of type t3.medium', () => {
  const template = synth();
  template.resourceCountIs('AWS::EC2::Instance', 1);
  template.hasResourceProperties('AWS::EC2::Instance', {
    InstanceType: 't3.medium',
  });
});

test('security group opens SSH (22) and Ollama API (11434) to the world', () => {
  const template = synth();
  template.hasResourceProperties('AWS::EC2::SecurityGroup', {
    SecurityGroupIngress: Match.arrayWith([
      Match.objectLike({ FromPort: 22, ToPort: 22, CidrIp: '0.0.0.0/0' }),
      Match.objectLike({ FromPort: 11434, ToPort: 11434, CidrIp: '0.0.0.0/0' }),
    ]),
  });
});

test('creates a key pair', () => {
  const template = synth();
  template.resourceCountIs('AWS::EC2::KeyPair', 1);
});

test('root volume is a single 20 GB gp3 disk', () => {
  const template = synth();
  template.hasResourceProperties('AWS::EC2::Instance', {
    BlockDeviceMappings: Match.arrayWith([
      Match.objectLike({
        DeviceName: '/dev/sda1',
        Ebs: Match.objectLike({ VolumeSize: 20, VolumeType: 'gp3' }),
      }),
    ]),
  });
});

test('user data installs Ollama and pulls the tiny model', () => {
  const template = synth();
  const instances = template.findResources('AWS::EC2::Instance');
  const userDataToken = Object.values(instances)[0].Properties.UserData;
  const encoded = JSON.stringify(userDataToken);
  // UserData is base64-encoded in the template; decode the Fn::Base64 literal part.
  const decoded = Buffer.from(
    userDataToken['Fn::Base64'] ?? '',
    'utf8',
  ).toString();
  const haystack = decoded || encoded;
  expect(haystack).toContain('ollama.com/install.sh');
  expect(haystack).toContain('llama3.2:1b');
});
