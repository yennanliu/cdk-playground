import { Duration, RemovalPolicy } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface AgentStateProps {
  /** How long a thread's conversation state survives after its last message. */
  readonly sessionTtl?: Duration;
}

/**
 * Everything the agent remembers between messages.
 *
 * Session state is keyed by Slack thread, which keeps the gateway process
 * stateless -- the property that makes the Phase 1 move to a horizontally
 * scaled Fargate service a lift-and-shift rather than a rewrite.
 */
export class AgentState extends Construct {
  /** `channel_id#thread_ts` -> conversation history and in-flight job status. */
  readonly sessions: dynamodb.TableV2;

  /** Transcripts, diffs, and job logs worth keeping past the session TTL. */
  readonly artifacts: s3.Bucket;

  readonly sessionTtl: Duration;

  constructor(scope: Construct, id: string, props: AgentStateProps = {}) {
    super(scope, id);

    this.sessionTtl = props.sessionTtl ?? Duration.days(7);

    this.sessions = new dynamodb.TableV2(this, 'Sessions', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      // The agent writes `ttl` on every update; DynamoDB expires the row for us
      // so conversation memory stays bounded without a sweeper.
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.artifacts = new s3.Bucket(this, 'Artifacts', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }

  /** Grant a principal the read/write access the gateway needs. */
  grantReadWrite(grantee: iam.IGrantable): void {
    this.sessions.grantReadWriteData(grantee);
    this.artifacts.grantReadWrite(grantee);
  }
}
