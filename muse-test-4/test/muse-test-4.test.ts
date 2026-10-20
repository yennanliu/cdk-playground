import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MuseTest4Stack, MuseTest4StackProps, SENTINEL_PORTS, bedrockInvoke } from '../lib/muse-test-4-stack';

const ENV = { account: '123456789012', region: 'ap-northeast-1' };
const S3_PREFIX_LIST = 'pl-61a54008';
const CLOUDFRONT_PREFIX_LIST = 'pl-58a04531';

function synth(props: Partial<MuseTest4StackProps> = {}) {
  const lookup = (name: string, id: string) => ({
    [`cc-api-provider:account=${ENV.account}:expectedMatchCount=exactly-one:propertiesToReturn.0=PrefixListId:` +
    `propertyMatch.PrefixListName=${name}:region=${ENV.region}:typeName=AWS$:$:EC2$:$:PrefixList`]: [
      { PrefixListId: id, Identifier: id },
    ],
  });
  const app = new cdk.App({
    context: {
      ...lookup(`com.amazonaws.${ENV.region}.s3`, S3_PREFIX_LIST),
      ...lookup('com.amazonaws.global.cloudfront.origin-facing', CLOUDFRONT_PREFIX_LIST),
    },
  });
  return Template.fromStack(new MuseTest4Stack(app, 'TestStack', { env: ENV, ...props }));
}

const template = synth();

/** Logical ID of the single resource of `type` whose ID starts with `prefix`. */
function logicalId(type: string, prefix: string, t = template): string {
  const ids = Object.keys(t.findResources(type)).filter((id) => id.startsWith(prefix));
  expect(ids).toHaveLength(1);
  return ids[0];
}

/** All IAM statements attached to the role with this logical-ID prefix. */
function statementsOf(rolePrefix: string): any[] {
  const role = logicalId('AWS::IAM::Role', rolePrefix);
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === role))
    .flatMap((p: any) => p.Properties.PolicyDocument.Statement);
}
const actionsOf = (rolePrefix: string) => statementsOf(rolePrefix).flatMap((s) => [s.Action].flat());

function container(taskPrefix: string, t = template): any {
  const task = t.findResources('AWS::ECS::TaskDefinition')[logicalId('AWS::ECS::TaskDefinition', taskPrefix, t)];
  return task.Properties.ContainerDefinitions[0];
}
const envOf = (taskPrefix: string, t = template): Record<string, any> =>
  Object.fromEntries(container(taskPrefix, t).Environment.map((e: any) => [e.Name, e.Value]));

function securityGroup(prefix: string): any {
  return template.findResources('AWS::EC2::SecurityGroup')[logicalId('AWS::EC2::SecurityGroup', prefix)].Properties;
}
const sgRef = (prefix: string) => ({ 'Fn::GetAtt': [logicalId('AWS::EC2::SecurityGroup', prefix), 'GroupId'] });

describe('network', () => {
  test('sandbox subnets have no route out', () => {
    const isolated = Object.entries(template.findResources('AWS::EC2::Subnet'))
      .filter(([, s]: any) => s.Properties.Tags.some((t: any) => t.Value === 'sandbox'))
      .map(([id]) => id);
    expect(isolated).toHaveLength(2);
    const routes = Object.values(template.findResources('AWS::EC2::Route')).map((r: any) => r.Properties);
    const tables = Object.values(template.findResources('AWS::EC2::SubnetRouteTableAssociation'))
      .filter((a: any) => isolated.includes(a.Properties.SubnetId.Ref))
      .map((a: any) => a.Properties.RouteTableId.Ref);
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(routes.filter((r) => r.RouteTableId.Ref === table)).toEqual([]); // no NAT, no IGW route
    }
  });

  test('sandbox security group: no ingress, egress only to the sentinel and AWS endpoints', () => {
    const sandbox = logicalId('AWS::EC2::SecurityGroup', 'SandboxSg');
    expect(securityGroup('SandboxSg').SecurityGroupIngress).toBeUndefined();
    const egress = [
      ...(securityGroup('SandboxSg').SecurityGroupEgress ?? []),
      ...Object.values(template.findResources('AWS::EC2::SecurityGroupEgress'))
        .map((r: any) => r.Properties)
        .filter((r) => r.GroupId['Fn::GetAtt'][0] === sandbox),
    ];
    const describe = (r: any) =>
      `${r.DestinationPrefixListId ?? r.DestinationSecurityGroupId['Fn::GetAtt'][0].replace(/[0-9A-F]{8}$/, '')}:${r.FromPort}`;
    expect(egress.map(describe).sort()).toEqual(
      [
        `${S3_PREFIX_LIST}:443`,
        'VpcEcrApiSecurityGroup:443',
        'VpcEcrDockerSecurityGroup:443',
        'VpcLogsSecurityGroup:443',
        `SentinelServiceSecurityGroup:${SENTINEL_PORTS.gateway}`,
        `SentinelServiceSecurityGroup:${SENTINEL_PORTS.proxy}`,
      ].sort(),
    );
  });

  test('the sentinel accepts its two ports from sandboxes only', () => {
    for (const port of Object.values(SENTINEL_PORTS)) {
      template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
        FromPort: port,
        ToPort: port,
        SourceSecurityGroupId: sgRef('SandboxSg'),
      });
    }
  });

  test('the ALB is internal and admits only CloudFront', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
    const alb = logicalId('AWS::EC2::SecurityGroup', 'AlbSecurityGroup');
    expect(securityGroup('AlbSecurityGroup').SecurityGroupIngress).toBeUndefined();
    const ingress = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress'))
      .map((r: any) => r.Properties)
      .filter((r) => r.GroupId['Fn::GetAtt'][0] === alb);
    expect(ingress).toEqual([
      expect.objectContaining({ SourcePrefixListId: CLOUDFRONT_PREFIX_LIST, FromPort: 80, ToPort: 80 }),
    ]);
  });

  test('CloudFront reaches the ALB as a VPC origin and forwards everything uncached', () => {
    template.resourceCountIs('AWS::CloudFront::VpcOrigin', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled
          OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader
        }),
      }),
    });
  });
});

describe('tasks', () => {
  test('one arm64 image for all three roles', () => {
    const images = ['Api', 'Sentinel', 'Sandbox'].map((t) => JSON.stringify(container(t).Image));
    expect(new Set(images).size).toBe(1);
    expect(['Api', 'Sentinel', 'Sandbox'].map((t) => container(t).Command)).toEqual([
      ['python', '-m', 'muse.api'],
      ['python', '-m', 'muse.sentinel'],
      ['python', '-m', 'muse.sandbox'],
    ]);
    template.allResourcesProperties('AWS::ECS::TaskDefinition', {
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    });
  });

  test('the sandbox is a task definition, never a service', () => {
    const services = Object.values(template.findResources('AWS::ECS::Service')).map(
      (s: any) => s.Properties.TaskDefinition.Ref,
    );
    expect(services).toHaveLength(2);
    expect(services).not.toContain(logicalId('AWS::ECS::TaskDefinition', 'Sandbox'));
  });

  test('sandboxes find the sentinel by its Cloud Map name', () => {
    template.hasResourceProperties('AWS::ServiceDiscovery::PrivateDnsNamespace', { Name: 'muse.internal' });
    template.hasResourceProperties('AWS::ServiceDiscovery::Service', { Name: 'sentinel' });
    expect(envOf('Sandbox')).toMatchObject({
      MUSE_GATEWAY_URL: 'http://sentinel.muse.internal:8081',
      MUSE_PROXY_URL: 'http://sentinel.muse.internal:3128',
      MUSE_MODEL_ID: 'global.anthropic.claude-sonnet-5-5',
      MUSE_IDLE_SECONDS: '600',
    });
  });

  test('the api launches sandboxes into the isolated subnets with their security group', () => {
    const env = envOf('Api');
    expect(env).toMatchObject({
      MUSE_LAUNCHER: 'ecs',
      MUSE_SANDBOX_TASK_DEFINITION: { Ref: logicalId('AWS::ECS::TaskDefinition', 'Sandbox') },
      MUSE_SANDBOX_SECURITY_GROUPS: sgRef('SandboxSg'),
    });
    const subnets = JSON.stringify(env.MUSE_SANDBOX_SUBNETS);
    expect(subnets).toContain('VpcsandboxSubnet1');
    expect(subnets).toContain('VpcsandboxSubnet2');
  });

  test('no task gets the table except the api and the sentinel', () => {
    expect(envOf('Sandbox').MUSE_TABLE).toBeUndefined();
    expect(envOf('Api').MUSE_TABLE).toBeDefined();
    expect(envOf('Sentinel').MUSE_TABLE).toBeDefined();
  });

  test('every env var the stack sets is one the app reads', () => {
    const config = fs.readFileSync(path.join(__dirname, '..', 'app', 'muse', 'config.py'), 'utf8');
    for (const name of ['Api', 'Sentinel', 'Sandbox'].flatMap((t) => Object.keys(envOf(t)))) {
      expect(config).toContain(`"${name}"`);
    }
  });

  test('ports match the app', () => {
    const sentinel = fs.readFileSync(path.join(__dirname, '..', 'app', 'muse', 'sentinel.py'), 'utf8');
    expect(sentinel).toContain(`port=${SENTINEL_PORTS.gateway}`);
    expect(sentinel).toContain(`port=${SENTINEL_PORTS.proxy}`);
  });

  test('context overrides reach the tasks', () => {
    const t = synth({ bedrockModelId: 'jp.anthropic.claude-haiku-5-5', allowedDomains: ['a.com', 'b.org'], idleMinutes: 3 });
    expect(envOf('Sandbox', t)).toMatchObject({ MUSE_MODEL_ID: 'jp.anthropic.claude-haiku-5-5', MUSE_IDLE_SECONDS: '180' });
    expect(envOf('Sentinel', t).MUSE_ALLOWED_DOMAINS).toBe('a.com,b.org');
  });
});

describe('least privilege', () => {
  test('a sandbox can call its one model and nothing else', () => {
    expect(statementsOf('SandboxTaskRole')).toEqual([
      expect.objectContaining({
        Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        Resource: [
          { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':bedrock:*::foundation-model/anthropic.claude-sonnet-5-5']] },
          {
            'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' },
              ':bedrock:ap-northeast-1:123456789012:inference-profile/global.anthropic.claude-sonnet-5-5']],
          },
        ],
      }),
    ]);
  });

  test('the sentinel: the table and the embedding model', () => {
    const actions = actionsOf('SentinelTaskRole');
    expect(actions).toContain('dynamodb:PutItem');
    expect(actions).toContain('bedrock:InvokeModel');
    expect(actions.some((a) => a.startsWith('ecs:'))).toBe(false);
  });

  test('the api: the table, and running and stopping sandboxes', () => {
    const actions = actionsOf('ApiTaskRole');
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:PutItem', 'ecs:RunTask', 'ecs:StopTask', 'iam:PassRole']));
    expect(actions.some((a) => a.startsWith('bedrock:'))).toBe(false);
    const passRole = statementsOf('ApiTaskRole').find((s) => s.Action === 'iam:PassRole');
    const passed = JSON.stringify(passRole.Resource);
    expect(passed).toContain('SandboxTaskRole');
    expect(passed).toContain('SandboxExecutionRole');
  });

  test('bedrockInvoke: bare model IDs need no inference profile', () => {
    const stack = new cdk.Stack(new cdk.App(), 'S', { env: ENV });
    const resources = stack.resolve(bedrockInvoke(stack, 'amazon.nova-pro-v1:0').toStatementJson().Resource);
    expect(JSON.stringify(resources)).toContain(':bedrock:*::foundation-model/amazon.nova-pro-v1:0');
    expect(JSON.stringify(resources)).not.toContain('inference-profile');
  });
});

describe('state', () => {
  test('one table keyed by user, with the sparse due-task index and TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'user', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: 'due',
          KeySchema: [
            { AttributeName: 'due', KeyType: 'HASH' },
            { AttributeName: 'next_run', KeyType: 'RANGE' },
          ],
        }),
      ],
      TimeToLiveSpecification: { AttributeName: 'expires', Enabled: true },
    });
  });

  test('the table schema matches the one the app creates locally', () => {
    const store = fs.readFileSync(path.join(__dirname, '..', 'app', 'muse', 'store.py'), 'utf8');
    for (const attr of ['"user"', '"sk"', '"due"', '"next_run"', 'DUE_INDEX = "due"']) expect(store).toContain(attr);
  });

  test('Cognito: admin-created users, password sign-in from the page', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      GenerateSecret: false,
    });
  });

  test('outputs', () => {
    for (const name of ['Url', 'UserPoolId', 'UserPoolClientId', 'ClusterName', 'LogGroup', 'CreateUserCommand']) {
      template.hasOutput(name, {});
    }
  });
});
