import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

/**
 * Configuration comes from two places, deliberately.
 *
 * `/etc/slack-agent/agent.env` is written by CDK user data and holds the
 * non-secret wiring -- table names, queue URLs, the model ID. systemd loads it
 * into the process environment. Secrets live in Secrets Manager and are fetched
 * at startup with the instance role, so they never touch the host filesystem.
 */
export interface Secrets {
  slackBotToken: string;
  slackAppToken: string;
  slackAlertChannel: string;
  githubAppId: string;
  githubInstallationId: string;
  githubPrivateKey: string;
}

export interface Config {
  region: string;
  sessionsTable: string;
  sessionTtlSeconds: number;
  artifactsBucket: string;
  jobsQueueUrl: string;
  jobRoleArn: string;
  jobTimeoutSeconds: number;
  modelId: string;
  workerImage: string;
  /** Turns off adaptive thinking if a model rejects it. */
  thinking: boolean;
  secrets: Secrets;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name} -- is /etc/slack-agent/agent.env loaded?`);
  return value;
}

export interface LoadOptions {
  /** `ask` runs the model without Slack, so it must not demand Slack tokens. */
  requireSlack?: boolean;
}

export async function loadConfig(options: LoadOptions = {}): Promise<Config> {
  const region = required('AWS_REGION');
  const client = new SecretsManagerClient({ region });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: required('AGENT_SECRET_ARN') }),
  );

  const secrets = JSON.parse(response.SecretString ?? '{}') as Partial<Secrets>;
  for (const key of options.requireSlack === false ? [] : (['slackBotToken', 'slackAppToken'] as const)) {
    if (!secrets[key]) {
      throw new Error(
        `secret key "${key}" is empty -- populate it with:\n` +
          '  aws secretsmanager put-secret-value --secret-id <stack>/config --secret-string file://config.json',
      );
    }
  }

  return {
    region,
    sessionsTable: required('AGENT_SESSIONS_TABLE'),
    sessionTtlSeconds: Number(process.env.AGENT_SESSION_TTL_SECONDS ?? 604800),
    artifactsBucket: required('AGENT_ARTIFACTS_BUCKET'),
    jobsQueueUrl: required('AGENT_JOBS_QUEUE_URL'),
    jobRoleArn: required('AGENT_JOB_ROLE_ARN'),
    jobTimeoutSeconds: Number(process.env.AGENT_JOB_TIMEOUT_SECONDS ?? 1800),
    modelId: required('AGENT_BEDROCK_MODEL_ID'),
    workerImage: process.env.AGENT_WORKER_IMAGE ?? 'slack-agent-worker:local',
    thinking: (process.env.AGENT_THINKING ?? 'adaptive') !== 'off',
    secrets: {
      slackAlertChannel: '',
      githubAppId: '',
      githubInstallationId: '',
      githubPrivateKey: '',
      ...secrets,
    } as Secrets,
  };
}

/**
 * Structured line logging -- `thread` is the correlation ID across the whole path.
 *
 * Always stderr: journald captures both streams for the service, and it leaves
 * stdout free for `ask.js` to return nothing but the answer.
 */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}
