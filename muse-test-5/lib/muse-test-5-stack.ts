import * as path from 'path';
import { KubectlV35Layer } from '@aws-cdk/lambda-layer-kubectl-v35';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';

const APP_DIR = path.join(__dirname, '..', 'app');
/** Must match the ports in app/muse/sentinel.py. */
export const SENTINEL_PORTS = { gateway: 8081, proxy: 3128 };
const API_PORT = 8080;
const EMBED_MODEL_ID = 'amazon.titan-embed-text-v2:0';
const NS = { control: 'control', sentinel: 'sentinel', sandboxes: 'sandboxes' };
const SENTINEL_HOST = `sentinel.${NS.sentinel}.svc.cluster.local`;
/** Node label (and, on sandbox nodes, taint) that splits the cluster into its two pools. */
const POOL = 'muse/pool';
const UID = 1000; // the image's `muse` user

/**
 * Installs gVisor's runsc as a containerd runtime. It runs after nodeadm has
 * written containerd's config and before containerd starts, so it appends the
 * `runsc` handler that the `gvisor` RuntimeClass names.
 */
const GVISOR_USER_DATA = `MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="MUSE"

--MUSE
Content-Type: text/x-shellscript; charset="us-ascii"

#!/bin/bash
set -euxo pipefail
url=https://storage.googleapis.com/gvisor/releases/release/latest/$(uname -m)
cd /tmp
for f in runsc containerd-shim-runsc-v1; do curl -fsSLO "$url/$f" -fsSLO "$url/$f.sha512"; done
sha512sum -c runsc.sha512 containerd-shim-runsc-v1.sha512
install -m 755 runsc containerd-shim-runsc-v1 /usr/local/bin/
config=/etc/containerd/config.toml
# containerd 2 (config version 3) moved the CRI runtime settings to a new plugin.
if grep -q '^version = 3' "$config"; then cri=io.containerd.cri.v1.runtime; else cri=io.containerd.grpc.v1.cri; fi
cat >> "$config" <<EOF

[plugins."$cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
EOF

--MUSE--
`;

export interface MuseTest5StackProps extends StackProps {
  /** Bedrock inference profile ID for the agent, e.g. `global.anthropic.claude-sonnet-5-5`. */
  readonly bedrockModelId?: string;
  /** Domains every user may browse without being asked. Everything else needs the user's approval. */
  readonly allowedDomains?: string[];
  /** A sandbox stops itself after this long with nothing to do. */
  readonly idleMinutes?: number;
  /** Sandbox nodes (m7g.large, about 3 sandboxes each). A fixed size: nothing autoscales them. */
  readonly sandboxNodes?: number;
  /** An IAM principal ARN (your role or user) to make cluster admin, for kubectl. */
  readonly adminPrincipalArn?: string;
}

/**
 * Approach E of `doc/build-your-own-muse.md`: EKS, one gVisor pod per active user.
 *
 *   browser ─► CloudFront ─► internal ALB ─► ns control: api (UI, JSON API, session manager, scheduler)
 *                                              │ creates a Job per user
 *                                              ▼
 *   ns sandboxes (gVisor, own nodes): sandbox pod, agent + Chromium ──► ns sentinel ──► NAT ──► Bedrock, the web
 *     NetworkPolicy: egress to the sentinel and DNS only              (gateway + egress proxy)
 *
 * The same app as muse-test-4. Only the api and the sentinel can touch the
 * table; each component has its own IAM role (IRSA), and a sandbox's can call
 * the model and nothing else.
 */
export class MuseTest5Stack extends Stack {
  constructor(scope: Construct, id: string, props: MuseTest5StackProps = {}) {
    super(scope, id, props);

    const modelId = props.bedrockModelId ?? 'global.anthropic.claude-sonnet-5-5';

    // --- network and cluster ------------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2, natGateways: 1 });
    vpc.addGatewayEndpoint('DynamoDb', { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB });

    const cluster = new eks.Cluster(this, 'Cluster', {
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      version: eks.KubernetesVersion.V1_35,
      defaultCapacityType: eks.DefaultCapacityType.NODEGROUP,
      defaultCapacity: 0,
      kubectlProviderOptions: { kubectlLayer: new KubectlV35Layer(this, 'Kubectl') },
      albController: { version: eks.AlbControllerVersion.V2_17_1 },
    });
    if (props.adminPrincipalArn) cluster.grantClusterAdmin('Admin', props.adminPrincipalArn);

    // The VPC CNI enforces NetworkPolicy (eBPF on each pod's interface) once this is on.
    new eks.CfnAddon(this, 'VpcCni', {
      clusterName: cluster.clusterName,
      addonName: 'vpc-cni',
      resolveConflicts: 'OVERWRITE',
      configurationValues: JSON.stringify({ enableNetworkPolicy: 'true' }),
    });

    const arm = { amiType: eks.NodegroupAmiType.AL2023_ARM_64_STANDARD };
    cluster.addNodegroupCapacity('System', {
      ...arm,
      instanceTypes: [new ec2.InstanceType('t4g.large')],
      minSize: 2,
      maxSize: 3,
      labels: { [POOL]: 'system' },
    });
    // Sandbox nodes: gVisor installed, tainted so only sandboxes land there, metadata out of pods' reach.
    const sandboxTemplate = new ec2.LaunchTemplate(this, 'SandboxNodes', {
      userData: ec2.UserData.custom(GVISOR_USER_DATA),
      requireImdsv2: true,
      httpPutResponseHopLimit: 1,
    });
    const sandboxNodes = props.sandboxNodes ?? 1;
    cluster.addNodegroupCapacity('Sandbox', {
      ...arm,
      instanceTypes: [new ec2.InstanceType('m7g.large')],
      minSize: sandboxNodes,
      desiredSize: sandboxNodes,
      maxSize: sandboxNodes,
      labels: { [POOL]: 'sandbox' },
      taints: [{ key: POOL, value: 'sandbox', effect: eks.TaintEffect.NO_SCHEDULE }],
      launchTemplateSpec: { id: sandboxTemplate.launchTemplateId!, version: sandboxTemplate.latestVersionNumber },
    });

    // --- state and users -------------------------------------------------------------------
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'user', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expires',
      // Sparse: only tasks carry `due`. The scheduler reads every user's due tasks from it.
      globalSecondaryIndexes: [
        {
          indexName: 'due',
          partitionKey: { name: 'due', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'next_run', type: dynamodb.AttributeType.NUMBER },
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const users = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const webClient = users.addClient('Web', { authFlows: { userPassword: true }, generateSecret: false });

    // --- namespaces, the gVisor RuntimeClass, and who may do what ------------------------------
    const base = cluster.addManifest(
      'Base',
      ...Object.values(NS).map((name) => ({
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name,
          // Sandboxes run code a web page steered: no root, no capabilities, no host access.
          labels: name === NS.sandboxes ? { 'pod-security.kubernetes.io/enforce': 'restricted' } : {},
        },
      })),
      {
        apiVersion: 'node.k8s.io/v1',
        kind: 'RuntimeClass',
        metadata: { name: 'gvisor' },
        handler: 'runsc',
        // Every gVisor pod goes to, and tolerates, the sandbox nodes: the Job template needs neither.
        scheduling: {
          nodeSelector: { [POOL]: 'sandbox' },
          tolerations: [{ key: POOL, operator: 'Equal', value: 'sandbox', effect: 'NoSchedule' }],
        },
      },
    );

    const serviceAccount = (name: string, namespace: string) => {
      const account = cluster.addServiceAccount(name, { name, namespace });
      account.node.addDependency(base);
      return account;
    };
    const apiAccount = serviceAccount('api', NS.control);
    const sentinelAccount = serviceAccount('sentinel', NS.sentinel);
    const sandboxAccount = serviceAccount('sandbox', NS.sandboxes);
    table.grantReadWriteData(apiAccount);
    table.grantReadWriteData(sentinelAccount);
    sentinelAccount.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:${this.partition}:bedrock:${this.region}::foundation-model/${EMBED_MODEL_ID}`],
      }),
    );
    sandboxAccount.addToPrincipalPolicy(bedrockInvoke(this, modelId));

    // --- one image, three roles ---------------------------------------------------------------
    const image = new DockerImageAsset(this, 'Image', { directory: APP_DIR, platform: Platform.LINUX_ARM64 })
      .imageUri;
    const env = (values: Record<string, string>) =>
      Object.entries({ AWS_REGION: this.region, ...values }).map(([name, value]) => ({ name, value }));
    const nonRoot = { runAsNonRoot: true, runAsUser: UID, seccompProfile: { type: 'RuntimeDefault' } };
    const locked = { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } };

    // The sandbox: a Job per user, created by the api from this template (it adds MUSE_TOKEN).
    const sandboxJob = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      spec: {
        backoffLimit: 0,
        ttlSecondsAfterFinished: 60,
        template: {
          spec: {
            runtimeClassName: 'gvisor',
            serviceAccountName: sandboxAccount.serviceAccountName,
            automountServiceAccountToken: false, // IRSA mounts its own token; no Kubernetes API access
            enableServiceLinks: false,
            restartPolicy: 'Never',
            securityContext: nonRoot,
            containers: [
              {
                name: 'sandbox',
                image,
                command: ['python', '-m', 'muse.sandbox'],
                env: env({
                  MUSE_MODEL_ID: modelId,
                  MUSE_GATEWAY_URL: `http://${SENTINEL_HOST}:${SENTINEL_PORTS.gateway}`,
                  MUSE_PROXY_URL: `http://${SENTINEL_HOST}:${SENTINEL_PORTS.proxy}`,
                  MUSE_IDLE_SECONDS: String((props.idleMinutes ?? 10) * 60),
                }),
                resources: { requests: { cpu: '500m', memory: '1Gi' }, limits: { memory: '2Gi' } },
                securityContext: locked,
              },
            ],
          },
        },
      },
    };

    // A long-running service on the system nodes: Deployment + Service.
    const service = (name: string, namespace: string, ports: number[], values: Record<string, string>) => [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name, namespace },
        spec: {
          replicas: 2,
          selector: { matchLabels: { app: name } },
          template: {
            metadata: { labels: { app: name } },
            spec: {
              serviceAccountName: name,
              nodeSelector: { [POOL]: 'system' },
              securityContext: nonRoot,
              containers: [
                {
                  name,
                  image,
                  command: ['python', '-m', `muse.${name}`],
                  env: env(values),
                  ports: ports.map((containerPort) => ({ containerPort })),
                  readinessProbe: { httpGet: { path: '/health', port: ports[0] }, periodSeconds: 5 },
                  resources: { requests: { cpu: '250m', memory: '512Mi' }, limits: { memory: '1Gi' } },
                  securityContext: locked,
                },
              ],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name, namespace },
        spec: { selector: { app: name }, ports: ports.map((port) => ({ name: `p${port}`, port })) },
      },
    ];

    const apps = cluster.addManifest(
      'Apps',
      ...service('sentinel', NS.sentinel, [SENTINEL_PORTS.gateway, SENTINEL_PORTS.proxy], {
        MUSE_TABLE: table.tableName,
        MUSE_EMBED_MODEL_ID: EMBED_MODEL_ID,
        MUSE_ALLOWED_DOMAINS: (props.allowedDomains ?? []).join(','),
      }),
      ...service('api', NS.control, [API_PORT], {
        MUSE_TABLE: table.tableName,
        MUSE_USER_POOL_ID: users.userPoolId,
        MUSE_USER_POOL_CLIENT_ID: webClient.userPoolClientId,
        MUSE_LAUNCHER: 'kube',
        MUSE_SANDBOX_NAMESPACE: NS.sandboxes,
        MUSE_SANDBOX_JOB: this.toJsonString(sandboxJob),
      }),
      // The api's session manager: create and delete sandbox Jobs, nothing else.
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'Role',
        metadata: { name: 'session-manager', namespace: NS.sandboxes },
        rules: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'delete'] }],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: { name: 'session-manager', namespace: NS.sandboxes },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'session-manager' },
        subjects: [{ kind: 'ServiceAccount', name: apiAccount.serviceAccountName, namespace: NS.control }],
      },
      // Sandboxes: nothing comes in; out only to the sentinel and cluster DNS. No API server, no metadata, no web.
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: { name: 'sentinel-only', namespace: NS.sandboxes },
        spec: {
          podSelector: {},
          policyTypes: ['Ingress', 'Egress'],
          egress: [
            {
              to: [
                {
                  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': NS.sentinel } },
                  podSelector: { matchLabels: { app: 'sentinel' } },
                },
              ],
              ports: Object.values(SENTINEL_PORTS).map((port) => ({ protocol: 'TCP', port })),
            },
            {
              to: [
                {
                  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
                  podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
                },
              ],
              ports: ['UDP', 'TCP'].map((protocol) => ({ protocol, port: 53 })),
            },
          ],
        },
      },
    );
    apps.node.addDependency(base, apiAccount, sentinelAccount, sandboxAccount);

    // --- ingress: CloudFront (HTTPS) ─► internal ALB ─► api pods ------------------------------------------
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', { vpc, internetFacing: false });
    const cloudfrontOrigins = ec2.PrefixList.fromLookup(this, 'CloudFrontPrefixList', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    alb.connections.allowFrom(ec2.Peer.prefixList(cloudfrontOrigins.prefixListId), ec2.Port.tcp(80), 'CloudFront');
    alb.connections.allowTo(cluster, ec2.Port.tcp(API_PORT), 'api pods');
    const apiTargets = new elbv2.ApplicationTargetGroup(this, 'ApiTargets', {
      vpc,
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: '/health', interval: Duration.seconds(15) },
      deregistrationDelay: Duration.seconds(10),
    });
    alb.addListener('Http', { port: 80, open: false, defaultTargetGroups: [apiTargets] });
    // The ALB controller keeps the target group's IPs in step with the api pods.
    const binding = cluster.addManifest('ApiTargetGroupBinding', {
      apiVersion: 'elbv2.k8s.aws/v1beta1',
      kind: 'TargetGroupBinding',
      metadata: { name: 'api', namespace: NS.control },
      spec: {
        serviceRef: { name: 'api', port: API_PORT },
        targetGroupARN: apiTargets.targetGroupArn,
        targetType: 'ip',
      },
    });
    binding.node.addDependency(apps, cluster.albController!);

    const cdn = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Muse: web UI and JSON API',
      defaultBehavior: {
        origin: origins.VpcOrigin.withApplicationLoadBalancer(alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Every viewer header, including Authorization (the Cognito token), reaches the api.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });

    new CfnOutput(this, 'Url', { value: `https://${cdn.distributionDomainName}` });
    new CfnOutput(this, 'UserPoolId', { value: users.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: webClient.userPoolClientId });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'CreateUserCommand', {
      description: 'Create a user (replace EMAIL and PASSWORD), then sign in at Url',
      value:
        `aws cognito-idp admin-create-user --region ${this.region} --user-pool-id ${users.userPoolId} ` +
        `--username EMAIL --message-action SUPPRESS && ` +
        `aws cognito-idp admin-set-user-password --region ${this.region} --user-pool-id ${users.userPoolId} ` +
        `--username EMAIL --password PASSWORD --permanent`,
    });
  }
}

/**
 * Permission to call one model on Bedrock.
 *
 * Current Claude models are invoked through an inference profile (the model ID
 * prefixed with a geography such as `global.` or `jp.`), which needs permission
 * on both the profile and the foundation model -- in whichever region the
 * profile routes to, hence the wildcard region. Bare IDs need only the model.
 */
export function bedrockInvoke(stack: Stack, modelId: string): iam.PolicyStatement {
  const foundationModelId = modelId.replace(/^(global|us|eu|apac|jp)\./, '');
  return new iam.PolicyStatement({
    actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
    resources: [
      `arn:${stack.partition}:bedrock:*::foundation-model/${foundationModelId}`,
      ...(foundationModelId !== modelId
        ? [`arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${modelId}`]
        : []),
    ],
  });
}
