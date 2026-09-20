# slack-agent-1

A Slack-native agent on AWS that runs scheduled jobs, triages alerts, answers
questions, reads a codebase, and opens GitHub pull requests.

This repository holds **Phase 0** of that system: one EC2 host running the Slack
gateway in Socket Mode, launching every job in a throwaway container. Phase 0
exists to produce numbers — which tools the agent reaches for, how long real
coding tasks take, how often it gets a PR wrong, what the token bill looks like
— because every later architecture decision depends on them.

The full option survey and the phased plan are in
[`doc/slack-agent-aws-options.md`](doc/slack-agent-aws-options.md). This stack
implements Option 3 from that document.

---

## 1. System architecture

```
                  ┌──────────────────────────────────────────────┐
   Slack  ◄───────┤  outbound WebSocket (Socket Mode)            │
                  │  no inbound port, no public endpoint         │
                  └──────────────────────┬───────────────────────┘
                                         │
  ┌──────────────────────────────────────┼────────────────────────────────┐
  │ VPC (2 AZs, no NAT gateway)          │                                │
  │                                      ▼                                │
  │  ┌─────────────────────────────────────────────────────────────────┐  │
  │  │ EC2 t3.large — public subnet, security group with ZERO ingress  │  │
  │  │                                                                 │  │
  │  │   slack-agent-gateway.service    Bolt app, holds the WebSocket  │  │
  │  │            │                     answers fast queries inline    │  │
  │  │            │                                                    │  │
  │  │            ▼                                                    │  │
  │  │   slack-agent-run-job  ──►  ┌──────────────────────────────┐    │  │
  │  │   (per job)                 │ throwaway container          │    │  │
  │  │                             │  non-root, read-only rootfs  │    │  │
  │  │                             │  git + node + python + rg    │    │  │
  │  │                             │  Bedrock-only credentials    │    │  │
  │  │                             │  no IMDS, no host filesystem │    │  │
  │  │                             └──────────────────────────────┘    │  │
  │  └─────────────────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────────────────┘
        │              │              │              │              │
        ▼              ▼              ▼              ▼              ▼
  Secrets Mgr      DynamoDB          S3           SQS ◄─ SNS     Bedrock
  Slack + GitHub   sessions      artifacts       jobs queue      Claude
  credentials      thread-keyed   transcripts    + DLQ           (via job role)
                   7-day TTL      90-day expiry      ▲
                                                     │
                                          CloudWatch alarms,
                                          EventBridge schedules
```

Shell access is via **SSM Session Manager**. There is no SSH key and no open
port — not even 22.

## 2. How it works

Four entry points, one host.

**A user asks something in Slack.** The gateway holds an outbound WebSocket, so
the message arrives without any inbound port. Slack retries anything not
acknowledged in 3 seconds, so the gateway acks immediately and continues
asynchronously — it posts a placeholder and updates it. Conversation state is
read from and written to DynamoDB keyed by `channel_id#thread_ts`, never held in
process memory.

**A schedule fires.** EventBridge publishes to the SNS topic, which delivers to
the SQS queue with raw message delivery. The host polls that one queue.

**An alarm fires.** CloudWatch alarm actions point at the same SNS topic, so
alerts land on the same queue as scheduled jobs. The host has exactly one thing
to poll.

**A job needs a workspace** — read a repo, build it, run tests, open a PR. The
gateway mints a short-lived GitHub App installation token and shells out to
`slack-agent-run-job`, which creates a scratch directory, assumes the job role
for Bedrock-only credentials, and runs the worker image against it. The
container is destroyed and the scratch directory removed when the job ends,
whether it succeeded, failed, or hit the wall-clock timeout.

## 3. Design decisions

| Decision | Why |
|---|---|
| **Socket Mode, not the Events API** | Removes the public HTTPS endpoint, API Gateway, and the signing-secret verification code. An internal agent has no reason to accept inbound traffic. Costs an always-on process — which Phase 0 has anyway. |
| **No NAT Gateway** | The host only ever dials out. A public subnet behind a security group with zero ingress rules is no more reachable than a private subnet behind NAT, and saves ~$32/mo. Set `-c natGateways=1` if policy forbids a public IP. |
| **Jobs get their own IAM role** | The instance role reads secrets, sessions, and the queue. The job role invokes Bedrock and nothing else. A coding agent reads repository content, and repository content is untrusted input — a prompt-injected job must not reach your Slack or GitHub credentials. |
| **Containers can't reach IMDS** | An iptables rule in `DOCKER-USER` rejects `169.254.169.254` from containers. Without it a job could ask the metadata service for the *instance* role and the separate job role would be decorative. |
| **Gateway is stateless** | Session state in DynamoDB, not memory. Phase 1 runs two gateway tasks behind Socket Mode's own load balancing without a rewrite. |
| **One queue for every non-Slack trigger** | Schedules and alarms both land on the same SQS queue, so the host polls one thing. The SNS topic is the alarm-facing half. |
| **Bootstrap ships as an S3 asset** | `userDataCausesReplacement: true` means editing `assets/bootstrap.sh` replaces the instance on the next deploy. The running host cannot drift from what is in git. |
| **Worker image built on the host** | Phase 0 avoids an ECR repository and a build pipeline. Phase 1 pushes the same Dockerfile to ECR unchanged. |
| **Gateway unit installed, not enabled** | There is no application at `/opt/slack-agent/app` yet. A unit that crash-loops from first boot buries the bootstrap logs you would need to debug anything else. |

## 4. AWS components

| Resource | Construct | Purpose |
|---|---|---|
| `AWS::EC2::VPC` + 2 public subnets | `AgentNetwork` | Two AZs so the subnets exist for a Phase 1 Fargate move; the host occupies one. |
| `AWS::EC2::Instance` (t3.large, 100 GB gp3, encrypted) | `AgentHost` | The gateway. Persistent EBS is what makes repeat codebase questions fast — warm checkouts and caches. |
| `AWS::EC2::SecurityGroup` | `AgentHost` | Egress only. No ingress rules, and none should be added. |
| `AWS::IAM::Role` ×2 | `AgentHost` | Instance role and job role. See §5. |
| `AWS::SecretsManager::Secret` | stack | Slack bot/app tokens, GitHub App ID, installation ID, private key. Created with empty values; you populate it. |
| `AWS::DynamoDB::GlobalTable` | `AgentState` | `pk = channel_id#thread_ts` → history and job status. `ttl` attribute expires rows, so memory stays bounded without a sweeper. |
| `AWS::S3::Bucket` | `AgentState` | Transcripts, diffs, build logs. 90-day lifecycle, SSL enforced, public access blocked. |
| `AWS::SQS::Queue` ×2 | `AgentDispatch` | Jobs queue plus a dead-letter queue at `maxReceiveCount: 3`. Alarm on DLQ depth. |
| `AWS::SNS::Topic` | `AgentDispatch` | Alarm and EventBridge ingress, raw-delivered to the queue. |
| `AWS::Logs::LogGroup` | `AgentHost` | `/slack-agent/<stack>`, 14-day retention. Bootstrap and agent logs via the CloudWatch agent. |
| Amazon Bedrock | (no resource) | Claude, reached with the job role's credentials. Nothing to provision. |
| SSM Session Manager | `ssmSessionPermissions` | Shell access without SSH or an open port. |

## 5. IAM model

Two roles, deliberately disjoint. The synthesized template is asserted against
this in `test/slack-agent-1.test.ts`.

```
Instance role  (<stack>-agent-host)          Job role
───────────────────────────────────          ─────────────────────────────
secretsmanager:GetSecretValue                bedrock:InvokeModel
dynamodb:*Item / Query / Scan                bedrock:InvokeModelWithResponseStream
s3:GetObject* / PutObject*
sqs:ReceiveMessage / DeleteMessage           …and nothing else.
logs:PutLogEvents
sts:AssumeRole  ──────────────────────────►  (assumed per job, 1h max)
AmazonSSMManagedInstanceCore
CloudWatchAgentServerPolicy
```

The job role trusts the instance role by **literal ARN**, which is why the
instance role has a fixed name: referencing both role objects in each other's
properties would make the two CloudFormation resources mutually dependent, and
CloudFormation rejects that as a cycle.

## 6. Repository layout

```
bin/slack-agent-1.ts            app entry; reads -c context overrides
lib/slack-agent-1-stack.ts      composes the constructs, emits outputs
lib/constructs/
  network.ts                    VPC and subnet selection
  state.ts                      sessions table, artifacts bucket
  dispatch.ts                   alerts topic → jobs queue → DLQ
  agent-host.ts                 IAM, security group, user data, instance
assets/bootstrap.sh             installs Docker, builds the job image,
                                writes slack-agent-run-job, CloudWatch agent
docker/worker/Dockerfile        the throwaway job container
scripts/e2e-test.sh             end-to-end test against a deployed stack
test/slack-agent-1.test.ts      assertions against the synthesized template
doc/slack-agent-aws-options.md  the architecture survey this implements
```

## 7. Development

### Prerequisites

- Node 22+ and the AWS CLI v2, configured (`aws sts get-caller-identity`)
- CDK bootstrapped in the target account and region (`npx cdk bootstrap`)
- Docker only if you want to build the worker image locally; the host builds
  its own at boot

### Loop

```bash
npm install
npm run build           # type-check only — tsconfig sets noEmit
npm test                # unit tests against the synthesized template
npx cdk synth           # render CloudFormation to cdk.out/
npx cdk diff            # what a deploy would change
npx cdk deploy
./scripts/e2e-test.sh   # end-to-end test against the deployed stack
npx cdk destroy
```

`npm run build` does not emit JavaScript, so `lib/` and `bin/` stay clean.
`npm run clean` removes `cdk.out` and any stray build output; `npm run
clean:all` also drops `node_modules`.

If a second CDK command starts while one is in flight you will see *"Other CLIs
are currently reading from cdk.out"*. Pass `--output cdk.out.<name>` to the
second command, and do not delete that directory until the command finishes —
the CLI keeps reading it after CloudFormation is done, and removing it mid-run
leaves the process hung.

### Changing infrastructure

Edit the construct that owns the resource — `network`, `state`, `dispatch`, or
`agent-host` — rather than the stack. The stack only composes them and emits
outputs. Add a test for any invariant you would be upset to lose; the
credential-separation test is the model to follow.

### Changing the host bootstrap

`assets/bootstrap.sh` is shipped as an S3 asset and executed by user data.
Because the instance is configured with `userDataCausesReplacement: true`,
editing it replaces the instance on the next `cdk deploy` — the change actually
takes effect rather than sitting in git while the running host stays on the old
version.

Syntax-check before deploying, including the job runner nested inside it:

```bash
bash -n assets/bootstrap.sh
shellcheck assets/bootstrap.sh     # if installed
```

### Changing the worker image

`docker/worker/Dockerfile` is shipped as an S3 asset and built on the host at
boot. Build it locally first:

```bash
docker build -t slack-agent-worker:local docker/worker
docker run --rm slack-agent-worker:local git --version
```

Keep it free of anything that assumes a host — no volumes, no daemons, no
state. Phase 1 pushes this same image to ECR and runs it as a Fargate task.

Build for **linux/amd64** on an Apple Silicon machine (`--platform linux/amd64`)
— the host is x86_64, and an arm64 image will not run there.

The image deliberately ships no AWS SDK or CLI. Jobs `npm install` what they
need into the mounted workspace, which is writable while the root filesystem is
not; the gateway application will bring its own dependencies.

## 8. Deployment

```bash
npm install
npx cdk bootstrap          # once per account/region
npx cdk deploy
```

The deploy takes roughly 4–6 minutes, most of it waiting on the instance. The
bootstrap script then runs on first boot and takes another 2–3 minutes to
install Docker and build the worker image.

### Populate the credentials

The stack creates the secret with empty keys; you fill in the values.

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

Socket Mode needs no signing secret — that is an Events API concern, and there
is no HTTP endpoint here to sign. The Slack app needs Socket Mode enabled and
an app-level token with `connections:write`.

Use a **GitHub App**, not a personal access token: installation tokens expire in
an hour and are scoped to the repositories you select. Grant
`contents: write`, `pull_requests: write`, `metadata: read`, and nothing else.

### Bedrock model access — do this first

Two things bite here, both before any code runs.

**Current Claude models cannot be invoked by their bare foundation-model ID.**
Bedrock answers `anthropic.claude-opus-5` with *"Invocation of model ID ... with
on-demand throughput isn't supported. Retry your request with the ID or ARN of
an inference profile."* You must use an **inference profile** — the same ID
prefixed with a geography (`global.`, `jp.`, `apac.`, `us.`, ...). The stack
defaults to `global.anthropic.claude-opus-5` for this reason.

The IAM grant follows from that: invoking through a profile needs
`bedrock:InvokeModel` on **both** the profile ARN and the foundation model
behind it, and the foundation-model ARN carries no geography prefix.
`bedrockInvoke()` in `lib/constructs/agent-host.ts` derives both from the one
ID you configure, so there is nothing to keep in sync.

**Model access is granted per account, per model.** A model your account has
not enabled returns `AccessDeniedException` mentioning
`aws-marketplace:ViewSubscriptions` — which is about the *account*, not about
this stack's IAM. Enable it under Bedrock → Model access in the console.

Check what you can actually invoke before deploying:

```bash
aws bedrock list-inference-profiles \
  --query 'inferenceProfileSummaries[?contains(inferenceProfileId,`anthropic`)].inferenceProfileId'

echo '{"anthropic_version":"bedrock-2023-05-31","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' > body.json
aws bedrock-runtime invoke-model --model-id global.anthropic.claude-opus-5 \
  --content-type application/json --cli-binary-format raw-in-base64-out \
  --body file://body.json /dev/stdout
```

The `--cli-binary-format raw-in-base64-out` flag is required by AWS CLI v2;
without it the CLI rejects the body as invalid base64.

### Context overrides

```bash
npx cdk deploy -c natGateways=1                                 # private subnet, no public IP (+~$32/mo)
npx cdk deploy -c rootVolumeGiB=200                             # bigger repo cache
npx cdk deploy -c bedrockModelId=jp.anthropic.claude-sonnet-4-6 # a model your account has enabled
```

### Verify

This stack has been deployed and verified end to end in `ap-northeast-1`. The
checks below are the ones worth repeating:

```bash
aws cloudformation describe-stacks --stack-name SlackAgent1Stack \
  --query 'Stacks[0].Outputs' --output table

aws ssm start-session --target <instance-id>
```

On the host — note `cloud-init status --wait`, since the bootstrap keeps running
for two or three minutes after CloudFormation reports `CREATE_COMPLETE`:

```bash
cloud-init status --wait                       # bootstrap finished?
docker images | grep slack-agent-worker        # image built?
sudo iptables -S DOCKER-USER                   # IMDS blocked from containers?
systemctl is-active docker amazon-cloudwatch-agent
sudo slack-agent-run-job smoke-1 git --version # a real job, end to end
```

A job that proves the whole chain — isolation and model access together:

```bash
sudo slack-agent-run-job chain1 bash -c '
  curl -s --max-time 4 http://169.254.169.254/latest/meta-data/ \
    && echo "IMDS REACHABLE - INVESTIGATE" || echo "IMDS blocked"
  echo "uid=$(id -u)"
  cd /workspace && npm install --silent @aws-sdk/client-bedrock-runtime
  node -e "..."   # invoke \$AGENT_BEDROCK_MODEL_ID
'
```

You can confirm the credential separation from the host by assuming the job
role and checking that it is denied on the secret and the sessions table while
Bedrock still works.

### End-to-end test

One command checks everything that exists today:

```bash
./scripts/e2e-test.sh
STACK=SlackAgent1Stack REGION=ap-northeast-1 ./scripts/e2e-test.sh   # explicit
```

29 assertions across six groups: the host bootstrapped, alarms reach the jobs
queue, the session store and artifact bucket accept writes, a real job is
isolated (no IMDS, uid 1000, read-only root, workspace cleaned up), the job
role is **denied** on the secret, table, and bucket, and a job container can
invoke the configured model. It exits non-zero on any failure, so it works as a
post-deploy gate.

Host checks run through SSM, so it needs no SSH and no inbound port. It creates
and deletes exactly three things: one SNS message, one DynamoDB row, one S3
object. Expect two to three minutes, mostly SSM round trips and the
`npm install` inside the Bedrock job.

If the Bedrock check is the only failure, that is almost always account-level
model access rather than this stack — see **Bedrock model access** above.

## 9. Operations

```bash
aws ssm start-session --target <instance-id>      # shell, no SSH, no open port
sudo systemctl status slack-agent-gateway
sudo journalctl -u slack-agent-gateway -f
sudo slack-agent-run-job <id> <command...>        # run a job by hand
```

Logs reach CloudWatch at `/slack-agent/SlackAgent1Stack`. All host
configuration lives in `/etc/slack-agent/agent.env` — table name, bucket,
queue URL, job role ARN, model ID, timeouts.

Worth alarming on: DLQ depth, job failure rate, p95 job duration, daily token
spend.

## 10. Cost

Roughly **$35–60/month** at rest, dominated by the instance and its volume.

| Item | Approx/mo |
|---|---|
| t3.large, on demand | ~$25–30 |
| 100 GB gp3 | ~$10 |
| DynamoDB, S3, SQS, SNS, Secrets Manager, logs | ~$2–5 |
| NAT Gateway (only with `-c natGateways=1`) | +$32 |

**Excludes Bedrock tokens**, which are usually the largest line item and are
roughly independent of which architecture you pick. Set a budget alarm before
you run the agent unattended.

## 11. Teardown

```bash
npx cdk destroy
```

Everything is `RemovalPolicy.DESTROY` and the artifacts bucket auto-deletes its
objects — appropriate for Phase 0, wrong for anything holding data you want to
keep. Revisit before this carries production state.

## 12. What is not built yet

The gateway application. `slack-agent-gateway.service` is installed but not
enabled; deploy the app to `/opt/slack-agent/app`, then:

```bash
sudo systemctl enable --now slack-agent-gateway
```

It needs to hold the Socket Mode connection, ack Slack within 3 seconds and
continue asynchronously, dedupe on `X-Slack-Retry-Num`, read and write sessions
in DynamoDB, poll the jobs queue, mint a GitHub App installation token per job,
and shell out to `slack-agent-run-job`. Everything it needs is in
`/etc/slack-agent/agent.env`.

## 13. Guardrails

From `doc/slack-agent-aws-options.md` §6.2. The stack enforces the credential
separation; these are on you:

- **PR-only.** Never grant push access to `main`; enforce with branch protection.
- **Repo allowlist**, checked in code before an installation token is minted.
- **Human review required** — the agent opens the PR, a person merges it.
- **Per-job spend and wall-clock cap**, reported in-thread when it trips.
- **Treat repository content as untrusted input**, not as instructions.

One known sharp edge: the gateway is in the `docker` group, which on this host
is root-equivalent. It is the price of launching containers from an
unprivileged process, and the main thing Phase 1 buys back — on Fargate the
gateway only needs `ecs:RunTask`.

## 14. Path to Phase 1

The two things built deliberately in Phase 0 are what make the move cheap:

- `docker/worker/Dockerfile` becomes an ECR image and a Fargate task definition;
  `slack-agent-run-job` becomes `ecs:RunTask`. The job role carries over
  unchanged as the task role.
- The stateless gateway becomes a Fargate service with `desiredCount: 2`.
- `AgentDispatch` and `AgentState` move across untouched.

Phase 2 is chosen from Phase 0's measurements, not decided up front. See
`doc/slack-agent-aws-options.md` §5.
