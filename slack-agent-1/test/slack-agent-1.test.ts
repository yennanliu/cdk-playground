import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SlackAgent1Stack } from '../lib/slack-agent-1-stack';

function synthesize(props = {}): Template {
  const app = new cdk.App();
  const stack = new SlackAgent1Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    ...props,
  });
  return Template.fromStack(stack);
}

describe('Phase 0 agent host', () => {
  const template = synthesize();

  test('exposes no inbound port at all -- Socket Mode dials out', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Slack agent host -- egress only, no inbound',
      SecurityGroupIngress: Match.absent(),
    });
  });

  test('runs a single instance with an encrypted root volume', () => {
    template.resourceCountIs('AWS::EC2::Instance', 1);
    template.hasResourceProperties('AWS::EC2::Instance', {
      BlockDeviceMappings: Match.arrayWith([
        Match.objectLike({ Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3' }) }),
      ]),
    });
  });

  test('provisions no NAT gateway by default', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });
});

describe('job isolation', () => {
  const template = synthesize();

  test('a role exists that can invoke Bedrock', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          }),
        ]),
      }),
    });
  });

  // Invoking through an inference profile needs permission on the profile AND
  // on the foundation model behind it -- and the foundation-model ARN carries
  // no geography prefix. Granting only one of the two fails at invoke time with
  // AccessDenied, which no template assertion would otherwise catch.
  test('an inference profile grants both the profile and its foundation model', () => {
    const statements = JSON.stringify(
      Object.values(template.findResources('AWS::IAM::Policy')).map(
        (p) => p.Properties.PolicyDocument.Statement,
      ),
    );
    expect(statements).toContain('foundation-model/anthropic.claude-opus-5');
    expect(statements).toContain('inference-profile/global.anthropic.claude-opus-5');
  });

  // Regression: the job role trusts the instance role by literal ARN to avoid a
  // CloudFormation cycle, which also drops the ordering that reference implied.
  // Without an explicit dependency IAM rejects the trust policy at create time
  // with "Invalid principal in policy".
  test('job role is created after the instance role it trusts', () => {
    const roles = template.findResources('AWS::IAM::Role');
    const [jobRoleId] = Object.entries(roles)
      .filter(([, r]) => r.Properties?.Description?.includes('job container'))
      .map(([id]) => id);
    const [instanceRoleId] = Object.entries(roles)
      .filter(([, r]) => r.Properties?.Description === 'Slack agent gateway host')
      .map(([id]) => id);

    expect(jobRoleId).toBeDefined();
    expect(instanceRoleId).toBeDefined();
    expect(roles[jobRoleId].DependsOn).toContain(instanceRoleId);
  });

  // The invariant the whole design rests on: a prompt-injected job that gets
  // hold of its own credentials still cannot read the Slack or GitHub secrets.
  test('no single policy grants both Bedrock and the credentials secret', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    expect(policies.length).toBeGreaterThan(0);

    for (const policy of policies) {
      const statements = JSON.stringify(policy.Properties.PolicyDocument.Statement);
      const grantsBedrock = statements.includes('bedrock:InvokeModel');
      const grantsSecret = statements.includes('secretsmanager:GetSecretValue');
      expect(grantsBedrock && grantsSecret).toBe(false);
    }
  });
});

describe('dispatch and state', () => {
  const template = synthesize();

  test('alerts land on the same queue the host already polls', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'sqs',
      RawMessageDelivery: true,
    });
  });

  test('failed jobs fall through to a dead-letter queue', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
  });

  test('session rows expire so conversation memory stays bounded', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });
});
