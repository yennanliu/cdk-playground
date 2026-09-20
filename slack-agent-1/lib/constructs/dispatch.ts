import { Duration } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface AgentDispatchProps {
  /**
   * Must exceed the longest job the agent runs, or SQS will redeliver a job
   * that is still in progress and the agent will do it twice.
   */
  readonly jobTimeout: Duration;
}

/**
 * How work reaches the agent from somewhere other than a Slack message.
 *
 * A single queue carries every non-Slack trigger -- scheduled jobs and alert
 * notifications alike -- so the host has exactly one thing to poll. The topic
 * is the alarm-facing half: point CloudWatch alarms and EventBridge rules at
 * it and their payloads land on the same queue.
 */
export class AgentDispatch extends Construct {
  /** The one queue the host polls. */
  readonly jobs: sqs.Queue;

  /** Jobs that failed `maxReceiveCount` times. Alarm on its depth. */
  readonly deadLetters: sqs.Queue;

  /** Alarm actions and EventBridge rules publish here. */
  readonly alerts: sns.Topic;

  constructor(scope: Construct, id: string, props: AgentDispatchProps) {
    super(scope, id);

    this.deadLetters = new sqs.Queue(this, 'DeadLetters', {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

    this.jobs = new sqs.Queue(this, 'Jobs', {
      visibilityTimeout: props.jobTimeout,
      retentionPeriod: Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: { queue: this.deadLetters, maxReceiveCount: 3 },
    });

    this.alerts = new sns.Topic(this, 'Alerts', {
      displayName: 'Slack agent alert ingress',
    });

    // Raw delivery: the agent reads the alarm payload directly instead of
    // unwrapping an SNS envelope around it.
    this.alerts.addSubscription(new subs.SqsSubscription(this.jobs, { rawMessageDelivery: true }));
  }

  /** Grant a principal the right to consume jobs. */
  grantConsume(grantee: iam.IGrantable): void {
    this.jobs.grantConsumeMessages(grantee);
  }
}
