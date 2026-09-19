# Slack Agent on AWS — Architecture Options

**Date:** 2026-09-20  
**Subject:** Survey of AWS approaches for a Slack-native agent that runs scheduled jobs, monitors alerts, answers questions, reads a codebase, and opens GitHub PRs  
**Stack:** `slack-agent-1` (currently the CDK `sample-app` SNS/SQS scaffold)

---

## 1. What we are building

A single Slack app ("the agent") that a team talks to in channels and threads, backed by AWS
compute and an LLM. Five required capabilities:

| # | Capability | Trigger | Shape of the work |
|---|---|---|---|
| 1 | **Cron job** | Time-based | Recurring task ("post the 9am deploy digest", "close stale PRs nightly"). No user waiting. |
| 2 | **Alert monitor** | Event-based | CloudWatch alarm / EventBridge event / health check fires → agent triages, enriches, posts to a channel, optionally suggests a fix. |
| 3 | **Answer user query** | Slack message / slash command / mention | Interactive Q&A. Latency-sensitive. Needs conversation memory per thread. |
| 4 | **Check codebase** | Slack message, or chained from #2 | Clone/fetch a repo, search it, read files, reason over them, answer. Read-only. |
| 5 | **Implement code + open PR** | Slack message | Long agentic loop: checkout → edit → run build/tests → commit → push branch → open PR → report link back to the thread. |

### The critical observation

**These five capabilities do not share one runtime profile.** They split cleanly into two classes:

- **Class A — short, request-scoped, bursty** (#1, #2, #3): seconds to a couple of minutes,
  no working directory, no toolchain. Serverless is a natural fit and idles at ~$0.
- **Class B — long, stateful, sandboxed** (#4, #5): minutes to an hour, needs a real filesystem,
  `git`, a language toolchain, a package manager, and the ability to execute untrusted-ish
  commands the model decides on. This is where Lambda's 15-minute ceiling and read-only
  filesystem start to hurt.

Most of the option space below is really a bet on *how much you are willing to split those two
classes across different compute*. Section 7 gives the hybrid that most teams land on.

---

## 2. Two constraints that shape every option

### 2.1 Slack's 3-second acknowledgement rule

Slack retries any Events API delivery or slash command that isn't acknowledged with HTTP 200
within **3 seconds**, up to 3 times. No LLM call reliably finishes in 3 seconds. So **every**
option must ack immediately and continue asynchronously:

```
Slack → [ack 200 in <3s] → enqueue → worker does the real work → chat.postMessage back to thread
```

Practical consequences:
- Never do the LLM call in the request handler. Always hand off (SQS, async Lambda invoke, `ecs.runTask`, Step Functions).
- Post a placeholder ("on it :hourglass:") and update it with `chat.update`, or stream partials into the thread.
- Make the worker **idempotent** and dedupe on Slack's `X-Slack-Retry-Num` / the event `client_msg_id` — duplicate deliveries are normal, and a non-idempotent worker will open two PRs.

### 2.2 Socket Mode vs HTTP (Events API)

This choice constrains which compute you can use, so decide it early.

| | **HTTP / Events API** | **Socket Mode** |
|---|---|---|
| How | Slack POSTs to a public HTTPS URL | Your process holds an outbound WebSocket to Slack |
| Public ingress | Required (API Gateway / Function URL / ALB) | **None** — works from a private subnet with NAT |
| Compute | Works with Lambda (scale-to-zero) | Needs an **always-on process** (ECS/EC2/EKS) |
| Auth | Verify `X-Slack-Signature` HMAC + timestamp (replay window 5 min) | App-level token (`xapp-`) with `connections:write` |
| Scaling | Free, per-request | You run ≥1 task 24/7; multiple connections are load-balanced by Slack |
| Slack app distribution | Required for public/App-Directory apps | Not allowed for distributed apps; fine for internal ones |

**Rule of thumb:** internal team agent → Socket Mode removes an entire public attack surface and
the API Gateway layer. Multi-workspace / distributed app → HTTP.

---

## Option 1: Fully serverless (Lambda + EventBridge + Step Functions)

### Architecture

```
Slack Events API
  └── Lambda Function URL (or API GW HTTP API)
        └── "ack" Lambda  — verify signature, 200 in <200ms, drop event on SQS
              └── SQS (FIFO per channel, DLQ)
                    └── "agent" Lambda (15 min max, 10 GB RAM, 10 GB /tmp)
                          ├── Bedrock InvokeModel / Converse  (Claude)
                          ├── DynamoDB   — thread_ts → session/history (TTL)
                          ├── S3         — artifacts, transcripts
                          └── Octokit    — GitHub REST (read files, open PR)

EventBridge Scheduler ──(cron)──► "job" Lambda            [capability 1]
CloudWatch Alarm → SNS ─────────► "alert" Lambda          [capability 2]
Step Functions (Standard) ──────► multi-step agent loops  [capabilities 4, 5]
```

AWS services: Lambda, API Gateway/Function URL, SQS, DynamoDB, S3, EventBridge Scheduler,
Step Functions, Bedrock, Secrets Manager, CloudWatch.

### How the five capabilities land

1. **Cron** — EventBridge Scheduler → Lambda. Native, timezone-aware, one line of CDK. ✅ Excellent.
2. **Alerts** — Alarm → SNS → Lambda, or EventBridge rule → Lambda. ✅ Excellent; this is the canonical pattern.
3. **Query** — ack Lambda + worker Lambda. ✅ Good; cold start adds ~1–3s on the *worker*, which is invisible to the user because you already acked.
4. **Codebase** — use the **GitHub API** (contents/search/tree endpoints) rather than cloning, or a shallow clone into `/tmp` (up to 10 GB). ⚠️ Workable for small/medium repos; slow and cramped for monorepos, and no warm git cache between invocations.
5. **PR** — ❌ **The weak point.** A real "edit, install deps, run tests, iterate" loop routinely exceeds 15 minutes, and `/tmp` is wiped per execution environment. Step Functions can chain multiple 15-minute Lambdas, but you must checkpoint the workspace to S3 between steps, which is slow and fragile. Doable for small, single-file, no-build changes; painful otherwise.

### Pros
- **Scale-to-zero cost** — idles at literally a few dollars/month; you pay per Slack message.
- **No servers, no patching, no NAT Gateway** (Lambda outside a VPC gets free internet egress).
- **Best-in-class fit for capabilities 1–3** — EventBridge and SNS→Lambda are exactly this shape.
- **Fastest infrastructure to write in CDK** — no VPC, no cluster, no task definitions.
- **Fine-grained IAM per function** — the cron Lambda need not have GitHub write access.
- **Step Functions gives durable, resumable, observable orchestration** with retries and a visual execution graph — genuinely nice for multi-step agent loops.

### Cons
- **15-minute hard timeout** — a blocker for capability 5, not a nuisance. Plan around it or accept scope limits.
- **Ephemeral `/tmp`** — no warm repo cache; every codebase task re-fetches.
- **No arbitrary toolchain** — you must bake `git`, Node/Python/JDK, build tools into a container image Lambda (up to 10 GB) — possible, but you've now containerized anyway, which weakens the "simpler than ECS" argument.
- **Command execution is awkward** — running the model's chosen shell commands inside the same sandbox as your handler is poor isolation. There is no per-session microVM boundary.
- **Cold starts** on large container images (several seconds), mitigated by provisioned concurrency (which reintroduces a fixed cost).
- **Socket Mode impossible** — you must expose a public HTTPS endpoint and implement signature verification correctly.

### Implementation effort

**Medium — 5–8 days** for capabilities 1–4. Add **4–6 more days** and real frustration for capability 5.

```typescript
const events = new lambda.Function(this, 'SlackAck', { /* verify sig, enqueue */ });
events.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

const work = new lambda.Function(this, 'Agent', {
  timeout: Duration.minutes(15),
  memorySize: 3008,
  ephemeralStorageSize: Size.gibibytes(4),
});
work.addEventSource(new SqsEventSource(queue, { batchSize: 1 }));

new scheduler.CfnSchedule(this, 'DailyDigest', {
  scheduleExpression: 'cron(0 9 ? * MON-FRI *)',
  scheduleExpressionTimezone: 'Asia/Taipei',
  flexibleTimeWindow: { mode: 'OFF' },
  target: { arn: job.functionArn, roleArn: schedulerRole.roleArn },
});
```

**Best for:** Teams that want capabilities 1–4 quickly and cheaply, and are willing to treat
capability 5 as a later phase (or hand it off — see Option 5).

---

## Option 2: ECS Fargate — always-on service + on-demand task workers

### Architecture

```
ECS Cluster (Fargate)
  │
  ├── Service "gateway"  (desired=1..2, always on)
  │     └── Slack Bolt in SOCKET MODE  ← outbound WebSocket, no public ingress
  │           ├── answers fast queries inline            [capability 3]
  │           └── for heavy work: ecs.runTask(...)
  │
  └── Task "worker"  (RunTask, ephemeral, 20–200 GiB storage, no timeout)
        ├── full toolchain image: git, node, python, build tools, test runners
        ├── shallow clone → edit → build → test → commit → push
        ├── GitHub App installation token (1h TTL)       [capabilities 4, 5]
        └── posts result to the originating thread

EventBridge Scheduler ──(cron)──► ecs.RunTask "worker"   [capability 1]
CloudWatch Alarm → SNS → Lambda ► ecs.RunTask "worker"   [capability 2]
DynamoDB: thread_ts → {taskArn, status, session}
S3: transcripts, diffs, build logs
VPC: private subnets + NAT (or VPC endpoints for ECR/S3/Secrets/Bedrock)
```

AWS services: ECS Fargate, ECR, DynamoDB, S3, EventBridge Scheduler, SNS, Secrets Manager,
Bedrock, CloudWatch, VPC+NAT.

### How the five capabilities land

1. **Cron** — EventBridge Scheduler targets `ecs:RunTask` directly, no Lambda glue. ✅
2. **Alerts** — SNS → tiny Lambda → RunTask (or EventBridge rule → RunTask). ✅
3. **Query** — answered in-process by the always-on gateway; no cold start at all. ✅ **Best latency of any option.**
4. **Codebase** — worker task with a real filesystem and a warm-ish repo cache on EFS. ✅ Excellent.
5. **PR** — ✅ **The reason to pick this option.** No timeout, 16 vCPU / 120 GB available, full toolchain, one task per job = clean isolation and a natural kill switch (`StopTask`).

### Pros
- **One substrate covers all five capabilities well** — no capability is a compromise.
- **Socket Mode** eliminates public ingress, API Gateway, and signature-verification code.
- **Task-per-job isolation** — the model's shell commands run in a container that is destroyed afterward; blast radius is one task with one scoped task role.
- **No timeout** — long agentic coding loops are a normal workload, not an edge case.
- **Right-sized cost per job** — a 2 vCPU worker runs for 6 minutes and stops; Fargate Spot cuts worker cost ~70% for interruption-tolerant jobs.
- **Standard container workflow** — same image runs locally, which makes the agent loop genuinely testable on a laptop.
- **Matches the existing house pattern** in this repo (`ecs-*` stacks), so VPC/ALB/secrets conventions carry over.

### Cons
- **Always-on floor cost** — the gateway service runs 24/7 (~$10–15/mo at 0.25 vCPU/0.5 GB) plus **NAT Gateway ~$32/mo**, which is the real cost driver. VPC endpoints can replace NAT if you eliminate all public-internet egress — but the agent calls api.slack.com and api.github.com, so you need NAT (or a NAT instance at ~$4/mo).
- **More CDK surface** — VPC, cluster, two task definitions, IAM task roles, log groups, EFS access points.
- **Task start latency** — ~20–60s to pull the image and start a worker. Invisible for cron/alerts, noticeable if a user asks a codebase question and waits. Mitigate: keep a warm worker pool, or answer small questions in the gateway.
- **You own the container image** — Dockerfile, base-image CVE patching, ECR lifecycle policy.
- **Gateway is a small stateful bottleneck** — Socket Mode with `desired=2` gets you HA, but you must make handlers stateless and keep session state in DynamoDB.

### Implementation effort

**Medium–High — 10–15 days** for all five capabilities, including the worker image.

```typescript
const cluster = new ecs.Cluster(this, 'AgentCluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

// Always-on Socket Mode gateway
const gatewayTd = new ecs.FargateTaskDefinition(this, 'GatewayTd', { cpu: 256, memoryLimitMiB: 512 });
gatewayTd.addContainer('bolt', {
  image: ecs.ContainerImage.fromEcrRepository(repo, 'gateway'),
  secrets: {
    SLACK_BOT_TOKEN: ecs.Secret.fromSecretsManager(slackSecret, 'botToken'),
    SLACK_APP_TOKEN: ecs.Secret.fromSecretsManager(slackSecret, 'appToken'),
  },
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'gateway' }),
});
new ecs.FargateService(this, 'Gateway', { cluster, taskDefinition: gatewayTd, desiredCount: 1 });

// Ephemeral worker, launched per job
const workerTd = new ecs.FargateTaskDefinition(this, 'WorkerTd', {
  cpu: 2048, memoryLimitMiB: 4096,
  ephemeralStorageGiB: 50,
});

new scheduler.CfnSchedule(this, 'NightlyRepoSweep', {
  scheduleExpression: 'cron(0 2 * * ? *)',
  scheduleExpressionTimezone: 'Asia/Taipei',
  flexibleTimeWindow: { mode: 'OFF' },
  target: {
    arn: cluster.clusterArn,
    roleArn: schedulerRole.roleArn,
    ecsParameters: { taskDefinitionArn: workerTd.taskDefinitionArn, launchType: 'FARGATE' },
  },
});
```

**Best for:** A team agent that must do all five things, especially #5. **This is the default recommendation.**

---

## Option 3: Single EC2 "agent host"

### Architecture

```
EC2 (t3.large / m7g.large, private subnet, SSM Session Manager — no port 22)
  ├── systemd: slack-agent.service   — Bolt, Socket Mode
  ├── systemd: worker@.service       — per-job unit, or Docker-per-job
  ├── EBS gp3 100 GB                 — persistent repo checkouts, warm caches
  ├── IAM instance role              — Bedrock, Secrets Manager, S3, CloudWatch
  └── CloudWatch Agent               — logs + metrics
```

AWS services: EC2, EBS, Secrets Manager, S3, Bedrock, CloudWatch, SSM.

### How the five capabilities land

1. **Cron** — literally `cron`/systemd timers on the box (or EventBridge → SSM Run Command). ✅ Trivially simple.
2. **Alerts** — SNS → HTTPS is awkward inbound; instead subscribe an SQS queue and poll from the box. ✅ Fine.
3. **Query** — in-process, zero cold start. ✅
4. **Codebase** — ✅ **Best of all options.** Persistent checkouts on EBS mean `git fetch` instead of full clone, warm `node_modules`/pip caches, warm build outputs. A repeat codebase question is seconds, not minutes.
5. **PR** — ✅ Works, with full toolchain and no timeout.

### Pros
- **Lowest effort to a working agent** — one box, one process manager, `git clone`, done.
- **Warm state is free** — the single biggest practical speedup for capabilities 4 and 5.
- **Easiest to debug** — `ssm start-session` and you are looking at the actual agent's filesystem, logs, and git state.
- **Cheapest all-in for a single team** — ~$30–60/mo including EBS, no NAT if you accept a public subnet + strict SG (or ~$4/mo NAT instance).
- **No containerization work at all** — run the agent framework exactly as its docs describe.

### Cons
- **Single point of failure** — instance replacement = outage; the agent is "down" with no automatic recovery beyond an ASG of 1 + user-data bootstrap.
- **Weakest isolation of any option** — the LLM decides which shell commands to run, and they run on the same box that holds your GitHub App key and instance role. A prompt-injected instruction found *inside a repo file the agent reads* executes with the instance's credentials. Mitigate hard: run every job in a throwaway Docker container as a non-root user with a scoped, short-lived token, and keep the instance role minimal.
- **You own OS patching**, log rotation, disk-full incidents, and process supervision.
- **Concurrency is manual** — two simultaneous PR jobs on the same repo checkout will collide unless you implement per-repo locking or per-job worktrees.
- **Scales vertically only.**
- **Config drift** — "works on the box" state that isn't in CDK is a real risk; keep everything in user-data or an Ansible/SSM document.

### Implementation effort

**Low — 3–5 days.**

```typescript
const host = new ec2.Instance(this, 'AgentHost', {
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
  machineImage: ec2.MachineImage.latestAmazonLinux2023(),
  vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  blockDevices: [{ deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(100, { volumeType: ec2.EbsDeviceVolumeType.GP3 }) }],
  ssmSessionPermissions: true,
});
host.userData.addCommands(
  'dnf install -y git docker nodejs',
  'systemctl enable --now docker',
  // fetch tokens from Secrets Manager, install agent, enable systemd unit
);
```

**Best for:** A proof of concept, a solo/small-team internal agent, or validating the agent loop
before investing in Option 2. Deliberately a stepping stone.

---

## Option 4: Bedrock Agents / AgentCore (managed agent runtime)

> ⚠️ **Verify before committing:** AWS's managed agent stack (Bedrock Agents, and the newer
> AgentCore Runtime / Gateway / Memory / Code Interpreter / Browser primitives) has been moving
> fast and is not available in every region. Confirm current GA status, region availability, and
> quotas for your target region before making this the plan of record.

### Architecture

```
Slack (HTTP Events API)
  └── Lambda "ack" → InvokeAgent (async)
        └── Bedrock Agent
              ├── Orchestration loop      — managed ReAct/tool-use, you don't write it
              ├── Memory                  — managed per-session/per-user memory
              ├── Action Groups → Lambda  — your tools: post_to_slack, open_pr, query_metrics
              ├── Knowledge Base          — OpenSearch Serverless index over the codebase  [capability 4]
              └── Code Interpreter / Runtime sandbox — isolated session for code exec       [capability 5]

EventBridge Scheduler → Lambda → InvokeAgent   [capability 1]
CloudWatch Alarm → SNS → Lambda → InvokeAgent  [capability 2]
```

AWS services: Bedrock (Agents/AgentCore), Lambda, OpenSearch Serverless, S3, DynamoDB,
EventBridge, Secrets Manager.

### How the five capabilities land

1. **Cron** — EventBridge → Lambda → `InvokeAgent`. ✅
2. **Alerts** — same path; the agent's action groups let it pull metrics/logs to triage. ✅ Strong fit.
3. **Query** — managed session memory means you don't build thread history yourself. ✅
4. **Codebase** — a Knowledge Base over the repo gives **semantic search** out of the box, which beats grep for "where do we handle X?" questions. ⚠️ But it's an *index*, not a working copy: it goes stale between syncs, and it can't answer "what does `git blame` say" or "does this build?".
5. **PR** — ⚠️ Needs the managed sandbox (AgentCore Runtime/Code Interpreter) for a real workspace, or an action-group Lambda that delegates to Fargate. The managed sandbox is session-isolated and long-lived, which is the right shape — but you have less control over the toolchain inside it than with your own image.

### Pros
- **You don't write the agent loop** — tool selection, retries, and multi-step planning are managed. This is genuinely a large chunk of code and prompt-tuning you skip.
- **Managed memory and session isolation** — per-session microVM boundaries are exactly the right security model for running model-chosen code, and building that yourself is hard.
- **Knowledge Base is the cleanest answer to capability 4's "find the relevant code" half** — embeddings + chunking + sync handled for you.
- **Tracing and guardrails are first-class** — Bedrock Guardrails, invocation traces, and CloudWatch integration come with the platform.
- **Least custom code overall** if the managed pieces fit your use case.

### Cons
- **Strongest vendor lock-in in the list** — the orchestration, memory format, and tool schemas are AWS-specific. Migrating off means rewriting the agent, not redeploying it.
- **Hard to test locally** — you cannot run a Bedrock Agent on a laptop. The dev loop is deploy-and-observe, which is slow and will annoy your engineers daily.
- **Region and quota constraints**, and newer surfaces change under you.
- **Less control over the loop** — when the agent picks the wrong tool, your lever is prompt/instruction tuning rather than code.
- **Cost is less predictable** — OpenSearch Serverless has a meaningful minimum (OCU-hours), and managed runtime time is billed on top of model tokens.
- **Model choice is bound to Bedrock's catalog** in your region.

### Implementation effort

**Medium — 8–12 days**, but the distribution is unusual: infrastructure is fast, and most of the
time goes into action-group schemas, agent instructions, and knowledge-base sync — plus a slow
deploy-test cycle.

**Best for:** Teams already standardized on Bedrock, who value managed memory/guardrails/tracing
and want to minimize hand-written orchestration. Weaker fit if capability 5 is the priority.

---

## Option 5: Split control plane — Slack/AWS for ingress, GitHub Actions for code work

### Architecture

```
AWS side (thin)                          GitHub side (does the code work)
──────────────                           ────────────────────────────────
Slack → Lambda (ack)                     repository_dispatch
  ├── capabilities 1,2,3 handled here      └── Actions runner
  │   EventBridge / SNS / Bedrock                ├── actions/checkout (free, warm cache)
  │                                              ├── coding agent runs here
  └── capabilities 4,5 →  dispatch ──────────►   ├── build + test in the real CI env
                                                 ├── create branch, push, gh pr create
      Lambda (webhook receiver) ◄──────────────  └── callback → post PR link to Slack thread
```

AWS services: Lambda, API Gateway, EventBridge, DynamoDB, Secrets Manager, Bedrock (for 1–3).

### How the five capabilities land

1. **Cron** — EventBridge on AWS, or GitHub `schedule:` workflows. ✅ Either works.
2. **Alerts** — AWS side. ✅
3. **Query** — AWS side (Lambda + Bedrock). ✅
4. **Codebase** — ✅ **Structurally the best fit.** The code, the cache, the CI environment, and the credentials already live there. `actions/checkout` is instant and free.
5. **PR** — ✅ **Also the best fit.** `GITHUB_TOKEN` already has PR permissions scoped to the repo; branch protections, required checks, and CODEOWNERS apply automatically; the PR's own CI runs immediately on the agent's branch.

### Pros
- **Run the code work where the code lives** — no repo mirroring, no credential sprawl, no reimplementing CI to validate the agent's changes.
- **Permissions are naturally scoped** — per-repo `GITHUB_TOKEN`, no long-lived GitHub App key sitting on AWS compute.
- **Free-to-cheap compute for #4/#5** on public repos or within your Actions minutes allowance.
- **The agent's changes are validated by your real pipeline**, not a reimplementation of it.
- **The AWS side collapses to a handful of Lambdas** — genuinely the least AWS infrastructure of any option.
- **Good audit trail** — every agent code change is a workflow run with logs, attached to a PR.

### Cons
- **Two control planes** — debugging spans CloudWatch *and* Actions logs; secrets live in two places; two IaC systems (CDK + workflow YAML).
- **Latency and feedback are poor for interactive use** — queue time + runner boot means a codebase question takes minutes. Acceptable for #5, bad for #4-as-chat.
- **Hosted runner limits** — default 6h job timeout is fine, but concurrency limits and minute costs bite on private repos at volume; self-hosted runners give control but reintroduce the ops you were avoiding.
- **Weak fit for capability 2** — alert triage needs AWS-side context (metrics, logs, alarms), so it stays on AWS anyway. You have now split by capability, not simplified.
- **Awkward for multi-repo work** — a change spanning three repos is three workflow runs to coordinate.
- **Makes this CDK repo the minor half of the system**, which may be the opposite of the point.

### Implementation effort

**Low–Medium — 5–8 days**, and unusually front-loaded on GitHub-side YAML/permissions rather than CDK.

**Best for:** Teams whose #1 priority is capability 5, with heavy existing GitHub Actions
investment, and who are comfortable owning two platforms.

---

## Option 6: EKS (multi-tenant agent platform)

### Architecture

```
EKS cluster (managed node group or Karpenter)
  ├── Deployment "gateway"    — Socket Mode, HPA on message rate
  ├── Job-per-task            — one K8s Job per agent run, TTL-after-finished
  │     ├── resource limits + NetworkPolicy + gVisor/Kata for stronger isolation
  │     └── per-namespace tenancy: one namespace per team/workspace
  ├── IRSA                    — per-workload IAM, no shared node role
  ├── Karpenter               — spot-first, scale-to-zero between jobs
  └── EFS/EBS CSI             — repo caches
```

### Pros
- **Best isolation and quota story** — namespaces, NetworkPolicies, resource quotas, and a sandboxed runtime (gVisor/Kata) per job. Matters if the agent serves several teams or runs genuinely untrusted repo content.
- **Job-per-run with TTL** maps perfectly onto agent tasks, with retries and backoff built in.
- **Karpenter spot bin-packing** is the cheapest way to run *many* concurrent agent jobs.
- **Portable** — the same manifests run on any Kubernetes.
- **Reuses this repo's existing EKS conventions** (`eks-stack-*`, IRSA, ALB controller).

### Cons
- **~$75/mo control plane before a single pod runs**, plus nodes and NAT.
- **Highest operational burden by far** — cluster upgrades, add-on version matrices, CNI/CSI drift.
- **Enormous overkill for one Slack app** used by one team — you'd be building a platform to run a chatbot.
- **Slowest to first working agent**, and the ongoing tax never goes away.

### Implementation effort

**High — 3–4 weeks** (less if you fork an existing `eks-stack-*` here, but the ops burden remains).

**Best for:** Multi-team or multi-tenant agent platform, dozens of concurrent jobs, or a hard
requirement for sandboxed runtimes. **Not a starting point.**

---

## 3. Capability × Option fit matrix

Legend: ✅ strong · ⚠️ workable with caveats · ❌ poor fit

| Capability | 1 Serverless | 2 Fargate | 3 EC2 | 4 Bedrock Agents | 5 GH Actions | 6 EKS |
|---|---|---|---|---|---|---|
| **1. Cron job** | ✅ native | ✅ native | ✅ trivial | ✅ | ✅ | ✅ |
| **2. Alert monitor** | ✅ canonical | ✅ | ⚠️ poll SQS | ✅ strong | ⚠️ AWS half anyway | ✅ |
| **3. Answer query** | ✅ (cold start hidden) | ✅ best latency | ✅ best latency | ✅ managed memory | ⚠️ minutes | ✅ |
| **4. Check codebase** | ⚠️ API/`/tmp` limits | ✅ | ✅ warm caches | ⚠️ index goes stale | ✅ native | ✅ |
| **5. Implement + PR** | ❌ 15-min cap | ✅ | ✅ (weak isolation) | ⚠️ managed sandbox | ✅ native | ✅ |

**Read this table as the whole argument:** only Options 2, 3, and 6 clear every row, and of those,
Option 6 is disproportionate for one team. That is why the recommendation below is Fargate, with
EC2 as the proof of concept.

---

## 4. Comparison matrix

| Option | Effort | Est. monthly cost* | Scale-to-zero | Isolation | Max job length | Ops burden |
|---|---|---|---|---|---|---|
| **1. Serverless** | Medium (5–8 d) | **$5–25** | ✅ | ⚠️ shared exec env | 15 min | **Lowest** |
| **2. ECS Fargate** | Med–High (10–15 d) | $55–110 | ⚠️ gateway always on | ✅ task-per-job | Unbounded | Low–Medium |
| **3. EC2** | **Low (3–5 d)** | $35–60 | ❌ | ❌ shared host | Unbounded | Medium |
| **4. Bedrock Agents** | Medium (8–12 d) | $80–200+ | ✅ | ✅ managed microVM | Long (managed) | Low (but opaque) |
| **5. GH Actions split** | Low–Med (5–8 d) | $10–30 + CI min. | ✅ | ✅ runner-per-job | 6 h | Medium (two planes) |
| **6. EKS** | High (3–4 wk) | $180–350+ | ⚠️ Karpenter | ✅ **strongest** | Unbounded | **Highest** |

\* Rough estimates for one internal team at low-moderate volume. **Excludes LLM token cost**,
which is frequently the largest line item and is roughly option-independent. Costs including a
NAT Gateway (~$32/mo) dominate the AWS side for Options 2 and 6 — consider a NAT instance or
VPC endpoints.

---

## 5. Recommended path

### Phase 0 — Prove the agent loop (Option 3, ~1 week)

Stand up **one EC2 host** running the Slack app in Socket Mode. Do not optimize anything. The goal
is to learn what the agent actually needs: which tools it calls, how long real coding tasks take,
how often it gets #5 wrong, and what the token bill looks like. **Every downstream architecture
decision depends on numbers you do not have yet.** Run every job in a throwaway Docker container
from day one, so the isolation model doesn't have to be retrofitted.

### Phase 1 — Productionize (Option 2, ~2 weeks)

Move to **ECS Fargate**: the Phase 0 job container becomes the worker task definition largely
unchanged, and the Bolt process becomes the gateway service. Add EventBridge Scheduler for #1,
SNS→RunTask for #2, DynamoDB for thread sessions.

```
Gateway service (Socket Mode, always on)   → capability 3, and dispatch
Worker task (RunTask, per job)             → capabilities 1, 2, 4, 5
```

### Phase 2 — Optimize where it hurts

Pick based on Phase 0/1 evidence, not upfront:
- Gateway idle cost dominates → move #1/#2/#3 to **Lambda** (Option 1) and keep Fargate only for #4/#5. This hybrid is where many teams end up.
- Codebase questions are slow → EFS repo cache, or add a **Knowledge Base** (Option 4) for semantic search while keeping Fargate for execution.
- PR quality depends on CI feedback → route #5 to **GitHub Actions** (Option 5) and keep AWS for #1–#3.
- Multiple teams adopt it and jobs queue → **EKS** (Option 6).

### The hybrid, stated plainly

```
Lambda + EventBridge + SNS   →  #1 cron, #2 alerts, #3 query      (cheap, scale-to-zero)
Fargate RunTask              →  #4 codebase, #5 implement + PR    (long, sandboxed, toolchained)
DynamoDB                     →  thread_ts ⇄ job state, shared by both
```

The cost of the hybrid is a second deployment artifact and two places to look when debugging.
It is worth it only once you can measure the gateway's idle cost against that friction — which is
why it is Phase 2 and not Phase 1.

---

## 6. Cross-cutting decisions (independent of option)

### 6.1 GitHub credentials — use a GitHub App, not a PAT

A **GitHub App** installation token is scoped to selected repositories and expires in 1 hour.
A PAT is long-lived and typically over-scoped. Store the App's private key in Secrets Manager,
mint installation tokens per job, and never write them to logs or to the workspace.

Grant `contents: write`, `pull_requests: write`, `metadata: read` — and **nothing else**.

### 6.2 Guardrails for capability 5 — non-negotiable

The agent writes code and has credentials. Assume a repo file will eventually contain text that
tries to redirect it (prompt injection through source, issues, or PR comments).

- **PR-only.** Never grant push access to `main`. Enforce branch protection server-side, not by prompt.
- **Repo allowlist** in config, checked in code before the token is minted.
- **Human review required** — the agent opens the PR, a person merges it. Always.
- **No secrets in the workspace** — inject tokens as env vars into the job, not files; scrub from logs.
- **Per-job spend and wall-clock cap** — stop the task at N minutes or M tokens, and report the stop in-thread.
- **Egress allowlist** where practical (Slack, GitHub, Bedrock, your package registry).
- **Treat repo content as untrusted input**, not instructions.

### 6.3 State model

```
DynamoDB  slack_sessions   PK: channel_id#thread_ts
                           { history, job_arn, repo, status, ttl }
```
Thread-scoped sessions with a TTL (e.g. 7 days) keep the agent's memory bounded and make the
gateway stateless and horizontally scalable. S3 for transcripts, diffs, and build logs you want
to keep past the TTL.

### 6.4 Secrets

One Secrets Manager secret with JSON keys beats four separate secrets:
`{ botToken, appToken, signingSecret, githubAppId, githubPrivateKey }` — injected via
`ecs.Secret.fromSecretsManager(secret, 'botToken')` or Lambda env resolution. Rotate the Slack
tokens on a schedule; the GitHub App key is the one worth alarming on.

### 6.5 Observability

- Structured JSON logs with `thread_ts` as the correlation ID across ack → queue → worker → Slack.
- Metrics worth alarming on: job failure rate, p95 job duration, token spend per day, DLQ depth.
- Emit the agent's **tool calls** as log events — when it does something surprising, the tool trace is what you'll read, not the prose.
- Feed the agent's own failures back into Slack (a `#agent-ops` channel) — the fastest feedback loop you'll have.

### 6.6 Cost control

LLM tokens usually exceed AWS compute here. Set a Bedrock/provider budget alarm early, cap
per-job tokens, prefer a smaller model for triage and routing with escalation to a larger model
only for #4/#5, and cache repeated context (system prompt, repo conventions) where the provider
supports it.

---

## 7. Next steps for this CDK stack

`slack-agent-1` currently holds only the CDK `sample-app` SNS/SQS scaffold
(`SlackAgent1Stack` in `lib/slack-agent-1-stack.ts`). To start on the recommended path:

1. **Decide Socket Mode vs HTTP** (§2.2). For an internal team agent, choose Socket Mode — it deletes the API Gateway, the public endpoint, and the signature-verification code from every option.
2. **Create the Slack app** and record `botToken` / `appToken` / `signingSecret` into one Secrets Manager secret (§6.4).
3. **Create the GitHub App**, install it on the allowlisted repos, store the private key in the same secret (§6.1).
4. **Phase 0:** replace the SNS/SQS scaffold with VPC + EC2 + Secrets Manager + SSM (§5). Keep the SQS queue — it becomes the dispatch queue in Phase 1.
5. **Build the worker container image** (git + toolchain + agent runtime) and run jobs in it on the EC2 host from day one, so Phase 1 is a lift-and-shift into a Fargate task definition.
6. **Instrument before optimizing** — log job duration, token spend, and success rate per capability. Phase 2 should be chosen from that data.

Per this repo's `CLAUDE.md`: add the `clean` script to `package.json` and keep compiled `*.js`/
`*.d.ts` out of `lib/` and `bin/`.
