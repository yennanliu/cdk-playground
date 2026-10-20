import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MuseTest5Stack, MuseTest5StackProps, SENTINEL_PORTS, bedrockInvoke } from '../lib/muse-test-5-stack';

const ENV = { account: '123456789012', region: 'ap-northeast-1' };
const CLOUDFRONT_PREFIX_LIST = 'pl-58a04531';

function synth(props: Partial<MuseTest5StackProps> = {}) {
  const app = new cdk.App({
    context: {
      [`cc-api-provider:account=${ENV.account}:expectedMatchCount=exactly-one:propertiesToReturn.0=PrefixListId:` +
      `propertyMatch.PrefixListName=com.amazonaws.global.cloudfront.origin-facing:region=${ENV.region}:` +
      `typeName=AWS$:$:EC2$:$:PrefixList`]: [
        { PrefixListId: CLOUDFRONT_PREFIX_LIST, Identifier: CLOUDFRONT_PREFIX_LIST },
      ],
    },
  });
  return Template.fromStack(new MuseTest5Stack(app, 'TestStack', { env: ENV, ...props }));
}

const template = synth();

/** A CloudFormation value as text, with every token (Ref, GetAtt, ...) shown as "<token>". */
function text(value: any): string {
  if (typeof value === 'string') return value;
  if (value['Fn::Join']) return value['Fn::Join'][1].map(text).join(value['Fn::Join'][0]);
  return '<token>';
}

/** Every Kubernetes object the stack applies, from all its manifests. */
function objects(t = template): any[] {
  return Object.values(t.findResources('Custom::AWSCDK-EKS-KubernetesResource')).flatMap((r: any) =>
    JSON.parse(text(r.Properties.Manifest)),
  );
}
function object(kind: string, name: string, t = template): any {
  const found = objects(t).filter((o) => o.kind === kind && o.metadata.name === name);
  expect(found).toHaveLength(1);
  return found[0];
}
const envOf = (container: any): Record<string, string> =>
  Object.fromEntries(container.env.map((e: any) => [e.name, e.value]));
const sandboxJob = (t = template) =>
  JSON.parse(envOf(object('Deployment', 'api', t).spec.template.spec.containers[0]).MUSE_SANDBOX_JOB);

/** IAM actions granted to the IRSA role of one service account. */
function actionsOf(account: string): string[] {
  const roles = Object.keys(template.findResources('AWS::IAM::Role')).filter((id) =>
    id.startsWith(`Cluster${account}Role`),
  );
  expect(roles).toHaveLength(1);
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === roles[0]))
    .flatMap((p: any) => p.Properties.PolicyDocument.Statement)
    .flatMap((s: any) => [s.Action].flat());
}

describe('cluster', () => {
  test('network policy is enforced by the VPC CNI', () => {
    template.hasResourceProperties('AWS::EKS::Addon', {
      AddonName: 'vpc-cni',
      ConfigurationValues: JSON.stringify({ enableNetworkPolicy: 'true' }),
    });
  });

  test('sandbox nodes install gVisor, are tainted, and keep pods off instance metadata', () => {
    template.hasResourceProperties('AWS::EKS::Nodegroup', {
      Labels: { 'muse/pool': 'sandbox' },
      Taints: [{ Key: 'muse/pool', Value: 'sandbox', Effect: 'NO_SCHEDULE' }],
      LaunchTemplate: Match.objectLike({}),
    });
    const [launchTemplate] = Object.values(template.findResources('AWS::EC2::LaunchTemplate')) as any[];
    const data = launchTemplate.Properties.LaunchTemplateData;
    expect(data.MetadataOptions).toEqual({ HttpTokens: 'required', HttpPutResponseHopLimit: 1 });
    const userData = data.UserData['Fn::Base64'];
    expect(userData).toContain('install -m 755 runsc containerd-shim-runsc-v1');
    expect(userData).toContain('runtime_type = "io.containerd.runsc.v1"');
  });

  test('the gvisor RuntimeClass schedules onto sandbox nodes', () => {
    const runtime = object('RuntimeClass', 'gvisor');
    expect(runtime.handler).toBe('runsc');
    expect(runtime.scheduling.nodeSelector).toEqual({ 'muse/pool': 'sandbox' });
  });

  test('an admin principal is optional', () => {
    const admin = { PrincipalArn: 'arn:aws:iam::123456789012:role/Admin' };
    expect(template.findResources('AWS::EKS::AccessEntry', { Properties: admin })).toEqual({});
    synth({ adminPrincipalArn: admin.PrincipalArn }).hasResourceProperties('AWS::EKS::AccessEntry', admin);
  });
});

describe('sandboxes', () => {
  test('run under gVisor as non-root, with no Kubernetes API token', () => {
    const pod = sandboxJob().spec.template.spec;
    expect(pod).toMatchObject({
      runtimeClassName: 'gvisor',
      serviceAccountName: 'sandbox',
      automountServiceAccountToken: false,
      restartPolicy: 'Never',
      securityContext: { runAsNonRoot: true },
    });
    expect(pod.containers[0].securityContext.capabilities.drop).toEqual(['ALL']);
    expect(object('Namespace', 'sandboxes').metadata.labels).toMatchObject({
      'pod-security.kubernetes.io/enforce': 'restricted',
    });
  });

  test('are pointed at the sentinel, with the model and idle time from props', () => {
    const env = envOf(sandboxJob(synth({ idleMinutes: 5 })).spec.template.spec.containers[0]);
    expect(env).toMatchObject({
      MUSE_MODEL_ID: 'global.anthropic.claude-sonnet-5-5',
      MUSE_GATEWAY_URL: `http://sentinel.sentinel.svc.cluster.local:${SENTINEL_PORTS.gateway}`,
      MUSE_PROXY_URL: `http://sentinel.sentinel.svc.cluster.local:${SENTINEL_PORTS.proxy}`,
      MUSE_IDLE_SECONDS: '300',
    });
    expect(env.MUSE_TOKEN).toBeUndefined(); // the api adds it per sandbox
  });

  test('can reach only the sentinel and DNS, and nothing reaches them', () => {
    const policy = object('NetworkPolicy', 'sentinel-only');
    expect(policy.metadata.namespace).toBe('sandboxes');
    expect(policy.spec.podSelector).toEqual({});
    expect(policy.spec.policyTypes).toEqual(['Ingress', 'Egress']);
    expect(policy.spec.ingress).toBeUndefined();
    const [sentinel, dns] = policy.spec.egress;
    expect(sentinel.to[0].podSelector.matchLabels).toEqual({ app: 'sentinel' });
    expect(sentinel.ports.map((p: any) => p.port)).toEqual(Object.values(SENTINEL_PORTS));
    expect(dns.to[0].podSelector.matchLabels).toEqual({ 'k8s-app': 'kube-dns' });
    expect(dns.ports.map((p: any) => p.port)).toEqual([53, 53]);
  });
});

describe('who may do what', () => {
  test('the sandbox role can only call the model', () => {
    expect(actionsOf('sandbox')).toEqual(['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream']);
  });

  test('the api and sentinel use the table; only the sentinel embeds', () => {
    expect(actionsOf('api')).toEqual(expect.arrayContaining(['dynamodb:PutItem', 'dynamodb:Query']));
    expect(actionsOf('api')).not.toContain('bedrock:InvokeModel');
    expect(actionsOf('sentinel')).toEqual(expect.arrayContaining(['dynamodb:PutItem', 'bedrock:InvokeModel']));
  });

  test('the api may only create and delete Jobs in the sandboxes namespace', () => {
    const role = object('Role', 'session-manager');
    expect(role.metadata.namespace).toBe('sandboxes');
    expect(role.rules).toEqual([{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'delete'] }]);
    expect(object('RoleBinding', 'session-manager').subjects).toEqual([
      { kind: 'ServiceAccount', name: 'api', namespace: 'control' },
    ]);
  });

  test('an inference profile needs the profile and the model', () => {
    const stack = new cdk.Stack(new cdk.App(), 'S', { env: ENV });
    const resources = stack.resolve(bedrockInvoke(stack, 'jp.anthropic.claude-haiku-5-5').toStatementJson()).Resource;
    expect(resources.map(text)).toEqual([
      'arn:<token>:bedrock:*::foundation-model/anthropic.claude-haiku-5-5',
      'arn:<token>:bedrock:ap-northeast-1:123456789012:inference-profile/jp.anthropic.claude-haiku-5-5',
    ]);
  });
});

describe('ingress', () => {
  test('CloudFront reaches an internal ALB, which forwards to the api pods', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      SourcePrefixListId: CLOUDFRONT_PREFIX_LIST,
      FromPort: 80,
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { TargetType: 'ip', Port: 8080 });
    const binding = object('TargetGroupBinding', 'api');
    expect(binding.spec.serviceRef).toEqual({ name: 'api', port: 8080 });
  });

  test('the api launches sandboxes on Kubernetes', () => {
    expect(envOf(object('Deployment', 'api').spec.template.spec.containers[0])).toMatchObject({
      MUSE_LAUNCHER: 'kube',
      MUSE_SANDBOX_NAMESPACE: 'sandboxes',
    });
  });
});
