# slack-agent-1 — Phase 0

One EC2 host running a Slack agent in Socket Mode, launching every job in a
throwaway container. This is **Phase 0** of the plan in
[`doc/slack-agent-aws-options.md`](doc/slack-agent-aws-options.md) — the
cheapest way to find out what the agent actually needs before committing to
Fargate.

The goal is measurement, not scale: which tools the agent reaches for, how long
real coding tasks take, how often it gets a PR wrong, and what the token bill
looks like. Every Phase 1 decision depends on numbers this stack produces.

## What gets deployed

```
VPC (2 AZs, no NAT)
  └── EC2 t3.large, public subnet, security group with ZERO ingress rules
        ├── slack-agent-gateway.service   — Bolt, Socket Mode (outbound WebSocket)
        ├── slack-agent-run-job           — one throwaway container per job
        └── CloudWatch agent              — bootstrap + agent logs

Secrets Manager  — Slack tokens, GitHub App key        (you populate)
DynamoDB         — channel#thread → session, 7-day TTL
S3               — transcripts, diffs, job logs, 90-day expiry
SNS → SQS        — alarms and scheduled jobs land on one queue the host polls
IAM              — instance role (secret/state/queue) ⊥ job role (Bedrock only)
```

Roughly **$35–60/month**, dominated by the instance and its 100 GB gp3 volume.
No NAT Gateway, no load balancer, no public port.

## Two things built right the first time

Everything else here is deliberately unoptimized. These two are not, because
retrofitting them later is expensive:

**Jobs don't inherit the host's credentials.** A job container receives
short-lived credentials for a separate role that can invoke Bedrock and nothing
else, and the bootstrap installs an iptables rule blocking containers from
reaching IMDS so a job can't ask for the instance role instead. This matters
because a coding agent reads repository content, and repository content is
untrusted input — a prompt-injected job still can't read your Slack or GitHub
credentials. The test suite asserts this separation.

**The gateway is stateless.** Conversation state lives in DynamoDB keyed by
Slack thread, never in process memory, so Phase 1 can run two gateways without
a rewrite.

## Deploy

```bash
npm install
npx cdk deploy
```

Then fill in the credentials the stack created empty keys for:

```bash
cat > config.json <<'JSON'
{
  "slackBotToken": "xoxb-...",
  "slackAppToken": "xapp-...",
  "githubAppId": "...",
  "githubInstallationId": "...",
  "githubPrivateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
}
JSON

aws secretsmanager put-secret-value \
  --secret-id SlackAgent1Stack/config --secret-string file://config.json
rm config.json
```

Socket Mode needs no signing secret — that's an Events API concern, and there's
no HTTP endpoint here to sign. The Slack app needs an app-level token with
`connections:write` and Socket Mode enabled.

Use a **GitHub App**, not a PAT: installation tokens expire in an hour and are
scoped to the repos you select. Grant `contents: write`,
`pull_requests: write`, `metadata: read`, and nothing else.

### Options

```bash
npx cdk deploy -c natGateways=1        # private subnet, no public IP (+$32/mo)
npx cdk deploy -c rootVolumeGiB=200    # bigger repo cache
npx cdk deploy -c bedrockModelId=anthropic.claude-sonnet-5
```

Bedrock model IDs carry an `anthropic.` prefix. Confirm what your region serves
with `aws bedrock list-inference-profiles`.

## Operate

```bash
aws ssm start-session --target <instance-id>    # no SSH, no open port
sudo tail -f /var/log/cloud-init-output.log     # bootstrap
sudo systemctl status slack-agent-gateway
sudo slack-agent-run-job smoke-1 git --version  # run a job by hand
```

Bootstrap logs stream to the `/slack-agent/SlackAgent1Stack` log group. Editing
`assets/bootstrap.sh` replaces the instance on the next deploy, so the running
host never drifts from what's in git.

## What is not here yet

The gateway application. `slack-agent-gateway.service` is installed but not
enabled, because there's nothing at `/opt/slack-agent/app` — a unit that
crash-loops from first boot buries the logs you'd need to debug anything else.
Deploy the app there, then:

```bash
sudo systemctl enable --now slack-agent-gateway
```

The app needs to: hold the Socket Mode connection, ack Slack within 3 seconds
and continue asynchronously, dedupe on `X-Slack-Retry-Num`, read and write
sessions in DynamoDB, poll the jobs queue, mint a GitHub App installation token
per job, and shell out to `slack-agent-run-job`. Everything it needs is in
`/etc/slack-agent/agent.env`.

## Guardrails to keep

From `doc/slack-agent-aws-options.md` §6.2, and not enforceable by this stack
alone:

- **PR-only.** Never grant push access to `main`; enforce with branch protection.
- **Repo allowlist**, checked before the installation token is minted.
- **Human review required** — the agent opens the PR, a person merges it.
- **Per-job spend cap**, reported in-thread when it trips.

## Layout

```
bin/slack-agent-1.ts          app entry; context overrides
lib/slack-agent-1-stack.ts    composes the constructs, emits outputs
lib/constructs/network.ts     VPC and subnet selection
lib/constructs/state.ts       sessions table, artifacts bucket
lib/constructs/dispatch.ts    alerts topic → jobs queue → DLQ
lib/constructs/agent-host.ts  IAM, security group, user data, instance
assets/bootstrap.sh           installs Docker, builds the job image, job runner
docker/worker/Dockerfile      the throwaway job container
```

## Commands

```bash
npm run build     # type-check (noEmit)
npm test          # unit tests against the synthesized template
npx cdk diff
npx cdk deploy
npx cdk destroy
npm run clean     # strip stray build output and cdk.out
```
