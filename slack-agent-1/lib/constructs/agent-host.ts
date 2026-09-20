import * as path from 'path';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { AgentDispatch } from './dispatch';
import { AgentNetwork } from './network';
import { AgentState } from './state';

const BOOTSTRAP = path.join(__dirname, '..', '..', 'assets', 'bootstrap.sh');
const WORKER_CONTEXT = path.join(__dirname, '..', '..', 'docker', 'worker');

/** Tag the host builds the job image under. Local only -- Phase 1 moves it to ECR. */
const WORKER_IMAGE = 'slack-agent-worker:local';

export interface AgentHostProps {
  readonly network: AgentNetwork;
  readonly state: AgentState;
  readonly dispatch: AgentDispatch;

  /** Slack tokens and the GitHub App private key. Populated out of band. */
  readonly secret: secretsmanager.ISecret;

  /** Bedrock model the agent reasons with. Bedrock IDs carry an `anthropic.` prefix. */
  readonly bedrockModelId: string;

  /** Wall-clock ceiling on one job. The container is killed at this point. */
  readonly jobTimeout: Duration;

  readonly instanceType: ec2.InstanceType;
  readonly rootVolumeGiB: number;
}

/**
 * The Phase 0 agent host: one EC2 instance running the Slack gateway, which
 * launches every job in a throwaway container.
 *
 * Two deliberate choices, both about blast radius rather than convenience:
 *
 *  - **No ingress.** The security group has no ingress rules at all. Slack is
 *    reached over an outbound WebSocket and shell access is via SSM Session
 *    Manager, so nothing needs to dial in -- including you.
 *
 *  - **Jobs do not inherit the host's credentials.** The instance role can read
 *    the secret, the session table, and the queue. A job container gets none of
 *    that: it receives short-lived credentials for a separate job role that can
 *    invoke Bedrock and nothing else, and the bootstrap blocks the container
 *    network from reaching IMDS so it cannot ask for the instance role instead.
 *    This matters because a coding agent reads repository content, and
 *    repository content is untrusted input.
 */
export class AgentHost extends Construct {
  readonly instance: ec2.Instance;

  /** Assumed per job; can invoke Bedrock and nothing else. */
  readonly jobRole: iam.Role;

  readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: AgentHostProps) {
    super(scope, id);

    const stack = Stack.of(this);

    this.logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/slack-agent/${stack.stackName}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Named up front so the job role can trust it by literal ARN. Referencing
    // the role object in both directions would make the two resources depend on
    // each other, which CloudFormation rejects as a cycle.
    const instanceRoleName = `${stack.stackName}-agent-host`;

    const instanceRole = new iam.Role(this, 'InstanceRole', {
      roleName: instanceRoleName,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Slack agent gateway host',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    this.jobRole = new iam.Role(this, 'JobRole', {
      assumedBy: new iam.ArnPrincipal(
        stack.formatArn({ service: 'iam', region: '', resource: 'role', resourceName: instanceRoleName }),
      ),
      description: 'Slack agent job container -- Bedrock only',
      maxSessionDuration: Duration.hours(1),
    });
    this.jobRole.addToPolicy(bedrockInvoke(stack, props.bedrockModelId));

    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [this.jobRole.roleArn],
      }),
    );

    props.secret.grantRead(instanceRole);
    props.state.grantReadWrite(instanceRole);
    props.dispatch.grantConsume(instanceRole);
    this.logGroup.grantWrite(instanceRole);

    // No ingress rules, and none should ever be added: Socket Mode dials out,
    // and SSM Session Manager provides the shell.
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.network.vpc,
      description: 'Slack agent host -- egress only, no inbound',
      allowAllOutbound: true,
    });

    const bootstrap = new s3assets.Asset(this, 'Bootstrap', { path: BOOTSTRAP });
    const workerContext = new s3assets.Asset(this, 'WorkerBuildContext', { path: WORKER_CONTEXT });
    bootstrap.grantRead(instanceRole);
    workerContext.grantRead(instanceRole);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'install -d -m 0750 /etc/slack-agent',
      // Single source of config for the gateway, the job runner, and anyone
      // debugging over SSM.
      "cat > /etc/slack-agent/agent.env <<'ENVEOF'",
      `AWS_REGION=${stack.region}`,
      `AGENT_SECRET_ARN=${props.secret.secretArn}`,
      `AGENT_SESSIONS_TABLE=${props.state.sessions.tableName}`,
      `AGENT_SESSION_TTL_SECONDS=${props.state.sessionTtl.toSeconds()}`,
      `AGENT_ARTIFACTS_BUCKET=${props.state.artifacts.bucketName}`,
      `AGENT_JOBS_QUEUE_URL=${props.dispatch.jobs.queueUrl}`,
      `AGENT_JOB_ROLE_ARN=${this.jobRole.roleArn}`,
      `AGENT_JOB_TIMEOUT_SECONDS=${props.jobTimeout.toSeconds()}`,
      `AGENT_BEDROCK_MODEL_ID=${props.bedrockModelId}`,
      `AGENT_WORKER_IMAGE=${WORKER_IMAGE}`,
      `AGENT_LOG_GROUP=${this.logGroup.logGroupName}`,
      'ENVEOF',
      'chmod 0640 /etc/slack-agent/agent.env',
    );
    userData.addS3DownloadCommand({
      bucket: workerContext.bucket,
      bucketKey: workerContext.s3ObjectKey,
      localFile: '/opt/slack-agent/worker.zip',
    });
    userData.addExecuteFileCommand({
      filePath: userData.addS3DownloadCommand({
        bucket: bootstrap.bucket,
        bucketKey: bootstrap.s3ObjectKey,
        localFile: '/opt/slack-agent/bootstrap.sh',
      }),
    });

    this.instance = new ec2.Instance(this, 'Host', {
      vpc: props.network.vpc,
      vpcSubnets: props.network.hostSubnets,
      instanceType: props.instanceType,
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup,
      role: instanceRole,
      userData,
      // Editing bootstrap.sh should actually reboot into the new bootstrap
      // rather than silently leaving the running host on the old one.
      userDataCausesReplacement: true,
      ssmSessionPermissions: true,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(props.rootVolumeGiB, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });
  }
}

/**
 * Permission to call one Claude model on Bedrock.
 *
 * Cross-region inference profiles dispatch to the foundation model in sibling
 * regions, so the foundation-model ARN is wildcarded across regions while the
 * model ID itself stays pinned. Confirm the ID your region serves with
 * `aws bedrock list-inference-profiles`.
 */
function bedrockInvoke(stack: Stack, modelId: string): iam.PolicyStatement {
  return new iam.PolicyStatement({
    actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
    resources: [
      `arn:${stack.partition}:bedrock:*::foundation-model/${modelId}`,
      `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/*`,
    ],
  });
}
