import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { AgentDispatch } from './constructs/dispatch';
import { AgentHost } from './constructs/agent-host';
import { AgentNetwork } from './constructs/network';
import { AgentState } from './constructs/state';

export interface SlackAgent1StackProps extends StackProps {
  /** Bedrock inference profile ID, e.g. `global.anthropic.claude-opus-5`. */
  readonly bedrockModelId?: string;
  readonly instanceType?: ec2.InstanceType;
  readonly rootVolumeGiB?: number;
  readonly jobTimeout?: Duration;
  readonly natGateways?: number;
}

/**
 * Phase 0 of the Slack agent (see `doc/slack-agent-aws-options.md`, Option 3).
 *
 * One EC2 host runs the Slack gateway in Socket Mode and launches every job in
 * a throwaway container. The point of Phase 0 is to learn what the agent
 * actually costs and how often it gets things wrong -- not to scale. Nothing
 * here is optimized, but two things are deliberately built right the first
 * time, because retrofitting them is expensive:
 *
 *   1. **Job isolation.** Jobs run in containers under a separate, minimal IAM
 *      role. Phase 1 replaces `docker run` with `ecs:RunTask` against the same
 *      image and the same role.
 *   2. **Stateless gateway.** Conversation state lives in DynamoDB keyed by
 *      Slack thread, never in process memory, so Phase 1 can run two of them.
 *
 * Deliberately absent: load balancer, auto-scaling, public ingress of any kind.
 */
export class SlackAgent1Stack extends Stack {
  constructor(scope: Construct, id: string, props: SlackAgent1StackProps = {}) {
    super(scope, id, props);

    const jobTimeout = props.jobTimeout ?? Duration.minutes(30);

    // Populated out of band -- `cdk deploy` creates the keys, you fill in the
    // values. Socket Mode needs no signing secret; that is an Events API
    // concern, and there is no HTTP endpoint here to sign.
    const secret = new secretsmanager.Secret(this, 'Config', {
      secretName: `${this.stackName}/config`,
      description: 'Slack bot/app tokens and GitHub App credentials',
      // Do not add or change keys here once the secret holds real values.
      // CloudFormation updates the secret whenever this rendered string
      // changes, which would overwrite whatever you put in out of band. The
      // gateway tolerates keys that are absent (`slackAlertChannel` is
      // optional), so add new ones to your config.json instead.
      secretObjectValue: {
        slackBotToken: SecretValue.unsafePlainText(''),
        slackAppToken: SecretValue.unsafePlainText(''),
        githubAppId: SecretValue.unsafePlainText(''),
        githubInstallationId: SecretValue.unsafePlainText(''),
        githubPrivateKey: SecretValue.unsafePlainText(''),
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const network = new AgentNetwork(this, 'Network', { natGateways: props.natGateways });
    const state = new AgentState(this, 'State');
    const dispatch = new AgentDispatch(this, 'Dispatch', { jobTimeout });

    const host = new AgentHost(this, 'Host', {
      network,
      state,
      dispatch,
      secret,
      jobTimeout,
      // An inference profile, not a bare foundation-model ID: current Claude
      // models reject on-demand invocation by bare ID. See `bedrockInvoke`.
      bedrockModelId: props.bedrockModelId ?? 'global.anthropic.claude-opus-5',
      instanceType:
        props.instanceType ?? ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      rootVolumeGiB: props.rootVolumeGiB ?? 100,
    });

    new CfnOutput(this, 'ShellCommand', {
      description: 'Open a shell on the host (no SSH, no open port)',
      value: `aws ssm start-session --target ${host.instance.instanceId}`,
    });
    new CfnOutput(this, 'ConfigCommand', {
      description: 'Fill in the Slack and GitHub credentials',
      value: `aws secretsmanager put-secret-value --secret-id ${secret.secretName} --secret-string file://config.json`,
    });
    new CfnOutput(this, 'AlertTopicArn', {
      description: 'Point CloudWatch alarm actions and EventBridge rules here',
      value: dispatch.alerts.topicArn,
    });
    new CfnOutput(this, 'JobsQueueUrl', { value: dispatch.jobs.queueUrl });
    new CfnOutput(this, 'SessionsTable', { value: state.sessions.tableName });
    new CfnOutput(this, 'ArtifactsBucket', { value: state.artifacts.bucketName });
    new CfnOutput(this, 'LogGroup', { value: host.logGroup.logGroupName });
  }
}
