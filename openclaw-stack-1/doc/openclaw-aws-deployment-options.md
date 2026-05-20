# OpenClaw AWS Deployment Options

**Date:** 2026-05-20  
**Subject:** Survey of AWS deployment approaches for OpenClaw

---

## What is OpenClaw?

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source autonomous AI agent that runs on your own infrastructure. It executes tasks via LLMs, integrates with messaging platforms (Slack, Discord, WhatsApp, iMessage), runs shell commands, interacts with browsers, and persists conversation context across sessions. Users bring their own LLM API keys (Anthropic, OpenAI, etc.).

**Key deployment constraints** that shape option selection:
- Long-running process (not request-scoped) — runs persistently, polling messaging backends
- Needs persistent filesystem for context/memory and file management tasks
- Browser automation (Playwright/Puppeteer) requires a headful or headless Chromium runtime
- Outbound internet access required for LLM API calls and messaging platform webhooks
- Stateful: conversation history must survive restarts

---

## Option 1: Pure EC2

### Architecture

```
Internet
  └── Elastic IP (optional)
        └── EC2 Instance (t3.medium+)
              ├── OpenClaw process (systemd service)
              ├── EBS Volume (persistent storage: memory, files, logs)
              └── Security Group (outbound HTTPS only)
```

AWS services used: EC2, EBS, IAM Role, Secrets Manager (for API keys), CloudWatch Agent (logs)

### Pros
- **Full OS control** — install any runtime (Node, Python, Chromium, ffmpeg) without container workarounds
- **No abstraction overhead** — OpenClaw runs exactly as documented, no porting required
- **Persistent local filesystem** — EBS volume survives reboots; no extra storage layer needed
- **Browser automation works natively** — headless Chromium runs without privilege hacks
- **Lowest cost** for a single always-on agent (t3.small ~$15/mo)
- **Fastest time-to-running** — launch instance, clone repo, run

### Cons
- **Single point of failure** — instance failure = outage; no built-in HA
- **Manual lifecycle management** — you handle OS patches, reboots, process restarts
- **No auto-scaling** — vertical only; must resize instance manually
- **No zero-downtime deploys** — requires scripting or CodeDeploy
- **Security surface** — need to harden SSH access (SSM Session Manager recommended over port 22)

### Implementation Effort

**Low** (1–2 days)

CDK sketch:
```typescript
const instance = new ec2.Instance(this, 'OpenClawHost', {
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
  machineImage: ec2.MachineImage.latestAmazonLinux2(),
  vpc,
  blockDevices: [{ deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(50) }],
});
// UserData script: install Node, clone repo, configure systemd service
```

**Best for:** Solo use, dev/personal deployment, fastest path to running.

---

## Option 2: ECS Fargate (Containerized)

### Architecture

```
ECR (Docker Image)
  └── ECS Cluster
        └── Fargate Task (OpenClaw container)
              ├── EFS Mount Point  ←── persistent memory/files
              ├── Secrets Manager  ←── LLM API keys injected as env vars
              └── CloudWatch Logs
VPC: private subnet + NAT Gateway for outbound LLM API calls
```

AWS services used: ECS, ECR, EFS, Secrets Manager, VPC+NAT, CloudWatch

### Pros
- **No server management** — AWS manages the compute plane
- **Container isolation** — reproducible, version-pinned environment
- **Managed restarts** — ECS automatically restarts crashed tasks
- **Easy image updates** — push new image to ECR, update task definition, ECS handles rollout
- **IAM roles per task** — fine-grained permissions without instance-level IAM
- **Cost-efficient scaling** — spin up multiple agent instances (multi-user/multi-tenant) without EC2 overhead

### Cons
- **Ephemeral container filesystem** — EFS required for any state; adds latency and cost (~$0.30/GB/mo)
- **Browser automation is harder** — Chromium in Fargate requires `--no-sandbox` flag and specific seccomp settings; `--privileged` not available
- **Cold start on task replacement** — ~30–60s to pull image and start container
- **Higher base cost** than EC2 for a single always-on task (0.25 vCPU + 0.5GB RAM ~$10/mo but EFS + NAT add ~$40–60/mo)
- **Containerization effort** — need a Dockerfile, EFS volume configuration, secrets wiring

### Implementation Effort

**Medium** (3–5 days)

CDK sketch:
```typescript
const fileSystem = new efs.FileSystem(this, 'OpenClawEfs', { vpc, removalPolicy: RemovalPolicy.RETAIN });

const taskDef = new ecs.FargateTaskDefinition(this, 'OpenClawTask', { cpu: 512, memoryLimitMiB: 1024 });
taskDef.addContainer('openclaw', {
  image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
  secrets: { ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret) },
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'openclaw' }),
});
// Mount EFS access point at /app/data
```

**Best for:** Team-shared deployment, multiple simultaneous agents, CI/CD-driven updates.

---

## Option 3: EKS (Kubernetes)

### Architecture

```
EKS Cluster
  └── Node Group (EC2 managed)
        └── Deployment: openclaw
              ├── Pod (OpenClaw container)
              │     ├── PersistentVolumeClaim → EFS StorageClass
              │     └── EnvFrom: ExternalSecrets (from Secrets Manager)
              └── HorizontalPodAutoscaler (scale by CPU/custom metrics)
Ingress: AWS Load Balancer Controller (if webhook endpoint needed)
```

AWS services used: EKS, EC2 Node Group, EFS CSI Driver, AWS Load Balancer Controller, External Secrets Operator, ECR, Secrets Manager

### Pros
- **Best for multi-tenant or multi-agent** — namespace isolation per user/team, quotas, RBAC
- **Advanced rollout strategies** — canary, blue-green, progressive delivery (Argo Rollouts)
- **Ecosystem richness** — Helm charts, GitOps (Argo CD / Flux), service mesh (Istio)
- **Horizontal scaling** — scale to N parallel agents trivially
- **Cloud-agnostic** — workloads portable to other clouds

### Cons
- **Massive operational overhead** — EKS cluster management, node group patching, add-on upgrades
- **Steep learning curve** — Kubernetes abstractions, IRSA, CSI drivers, ingress controllers
- **Highest cost** — EKS control plane ($73/mo) + EC2 nodes ($50–150/mo min) + EBS/EFS
- **Severe overkill for a single agent** — 80% of complexity is wasted for a personal deployment
- **Browser automation complexity** — same container constraints as ECS, plus pod security policies

### Implementation Effort

**High** (1–2+ weeks)

**Best for:** Platform teams deploying OpenClaw as a service for many users; organizations already running EKS who want to add it to an existing cluster.

---

## Option 4: Serverless (Lambda + Event-Driven)

### Architecture

```
Messaging Platform (Slack/Discord webhook)
  └── API Gateway (HTTP)
        └── Lambda: message-handler
              ├── DynamoDB  ←── conversation history
              ├── S3        ←── file storage
              └── SQS + Lambda: task-executor (async, 15min max)
                    └── Bedrock / External LLM API
```

AWS services used: Lambda, API Gateway, DynamoDB, S3, SQS, Secrets Manager, EventBridge (for scheduled tasks)

### Pros
- **True serverless economics** — pay per invocation, zero cost when idle
- **Infinite auto-scaling** — handles traffic spikes automatically
- **No infrastructure to manage** — fully managed
- **Native AWS integrations** — DynamoDB streams, S3 events, EventBridge rules

### Cons
- **Requires significant OpenClaw refactoring** — OpenClaw is designed as a persistent process; breaking it into Lambda handlers is a major re-architecture effort
- **15-minute Lambda timeout** — long-running agent tasks (multi-step browser automation, extended tool chains) won't fit in a single invocation
- **No persistent filesystem** — `/tmp` is 10GB but ephemeral; S3 required for all state
- **No browser automation** — Chromium won't run in Lambda (size/memory limits); would require Lambda@Edge + Lambda extension workarounds or external browser service (Browserless)
- **Cold starts** — 500ms–2s delay on first invocation affects responsiveness
- **Stateless context management** — must reload conversation context from DynamoDB on every call

### Implementation Effort

**Very High** (2–4+ weeks, requires architectural redesign)

**Best for:** If you only need the LLM Q&A capabilities of OpenClaw (no shell/browser automation) and want zero idle cost.

---

## Option 5: AWS App Runner

### Architecture

```
ECR (Docker Image)
  └── App Runner Service
        ├── Auto-scaling: min 1 instance
        ├── Secrets Manager integration (env vars)
        └── CloudWatch Logs
VPC Connector → private resources (EFS not natively supported)
```

AWS services used: App Runner, ECR, Secrets Manager, CloudWatch

### Pros
- **Simplest container deployment** — no ECS cluster or task definitions to manage
- **Automatic HTTPS endpoint** — built-in TLS, useful if OpenClaw exposes a webhook
- **Fast deploys** — push image to ECR, App Runner auto-redeploys
- **Low operational overhead** — between EC2 (manual) and ECS (moderate)

### Cons
- **No EFS support** — persistent storage is limited; S3 workarounds needed for state
- **Not designed for long-running daemon processes** — App Runner expects a web server on a port; OpenClaw's background polling model doesn't map cleanly
- **Less flexibility** than ECS for advanced networking or sidecar patterns
- **Cold starts on scale-down** — if scaled to 0, startup latency on first request

### Implementation Effort

**Low–Medium** (2–3 days if already containerized)

**Best for:** If you've already containerized OpenClaw for ECS and want a simpler alternative for the webhook endpoint specifically.

---

## Comparison Matrix

| Approach | Effort | Monthly Cost* | HA/Auto-Scale | Browser Automation | Persistent Storage | Best Use Case |
|---|---|---|---|---|---|---|
| **EC2** | Low | $15–30 | ✗ Manual | ✓ Native | ✓ EBS | Personal / solo dev |
| **ECS Fargate** | Medium | $60–100 | ✓ | ⚠ With flags | ✓ EFS | Team / multi-agent |
| **EKS** | High | $150–300+ | ✓ Advanced | ⚠ With flags | ✓ EFS/EBS | Multi-tenant platform |
| **Serverless** | Very High | $0–10 | ✓ Infinite | ✗ External only | ⚠ S3/DynamoDB | LLM-only, no automation |
| **App Runner** | Low–Med | $30–60 | ✓ | ⚠ With flags | ✗ Limited | Webhook endpoint only |

*Estimated monthly cost for a single always-on OpenClaw agent instance.

---

## Recommended Path

### For personal / small team use → **EC2 + Managed Services**

Start with EC2 (quick to ship), but integrate AWS managed services from the start:

```
EC2 Instance (OpenClaw daemon)
  ├── Secrets Manager  — API keys (no hardcoded secrets)
  ├── S3 Bucket        — file uploads/exports
  ├── CloudWatch Logs  — log aggregation
  └── SSM Session Manager — shell access (no SSH port 22 needed)
```

This gives you the native runtime OpenClaw expects while using AWS best-practice patterns for secrets and observability.

### For production / multi-user → **ECS Fargate + EFS**

Containerize first (Dockerfile), validate on ECS, add EFS for persistence. Path to EKS is straightforward later if scale demands it.

### If cost is the only driver → Spot EC2

Use an EC2 Spot instance with a persistent EBS volume (volume survives spot interruption). An interruption handler script gracefully stops OpenClaw and resumes on restart. ~70% cost savings vs on-demand.

---

## Next Steps for This CDK Stack

The `openclaw-stack-1` CDK stack currently has only an SNS/SQS scaffold. To implement the EC2 approach (recommended starting point):

1. Replace the SNS/SQS boilerplate with a VPC + EC2 construct
2. Add EBS volume, IAM role (SSM + CloudWatch + S3), and Security Group
3. Write UserData to install Node.js, clone OpenClaw, and register a systemd service
4. Store LLM API keys in Secrets Manager; reference them from the UserData script

---

*Sources: [OpenClaw GitHub](https://github.com/openclaw/openclaw) · [DigitalOcean: What is OpenClaw](https://www.digitalocean.com/resources/articles/what-is-openclaw) · [Milvus Blog: OpenClaw Guide](https://milvus.io/blog/openclaw-formerly-clawdbot-moltbot-explained-a-complete-guide-to-the-autonomous-ai-agent.md)*
