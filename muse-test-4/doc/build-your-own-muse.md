# Building Our Own "Meta Muse" From Scratch

> Survey + design options for building a Muse-style **personal AI agent** on AWS,
> from a single EC2 box up to a production-grade, multi-tenant EKS platform.
>
> Date: 2026-10-18 · Status: draft / idea doc

---

## 1. What is Meta Muse?

[Muse](https://ai.meta.com/muse/) is Meta's consumer **personal AI agent**,
launched 2026-09-08 (US; iOS, Android, web, WhatsApp). It is *not* just a chat
model: it is an agent product built on top of Meta's **Muse Spark** model
family (Spark 1.3 at launch).

| Capability | What Muse does |
|---|---|
| **Acts, not just answers** | Sends email, books travel, fills forms, negotiates, buys things |
| **Goal → plan → execute** | Turns a goal into a plan, coordinates time/resources, advances it on its own |
| **Long-term memory** | Remembers things mentioned once; user can inspect, edit, "forget" |
| **Own browser** | A real browser inside the agent's VM |
| **App connectors** | User picks apps + scope (e.g. email *read-only* vs *read+send*), revocable |
| **Background / scheduled work** | Keeps working after the app is closed; event-driven + scheduled tasks; pings back when something changes or needs approval |
| **Proactive suggestions** | e.g. saved recipe reel → grocery list |
| **Approvals + audit trail** | Confirms sensitive actions (send, buy); log of done + planned actions |
| **Hidden credentials** | Agent can *use* stored passwords/cards but never *see* them |
| **Payments** | Stripe Link one-time virtual cards; user approves the total |
| **Artifacts** | Produces docs, PDFs, interactive pages |

### The architecture Meta disclosed

```
┌───────────────────── Muse Secure VM (one per user) ─────────────────────┐
│                                                                         │
│   ┌──────────────┐   tool calls   ┌──────────┐                          │
│   │  Muse agent  │ ─────────────► │ Browser  │                          │
│   │ (Muse Spark) │                └────┬─────┘                          │
│   └──────┬───────┘                     │ all outbound traffic           │
│          │ connector actions           ▼                                │
│          │                     ┌───────────────┐   needs approval?      │
│          └───────────────────► │ Sentinel agent│ ─────────────────────► user
│                                │ (isolated at  │                        │
│   ┌──────────────────┐         │  system level)│ ──► internet / APIs    │
│   │ Credential store │ ◄────── └───────────────┘                        │
│   │ (agent can't read)│                                                 │
│   └──────────────────┘   user data · memory · connector tokens          │
└─────────────────────────────────────────────────────────────────────────┘
        Planned: "Confidential VM" – whole VM encrypted with a user-held key
```

Key ideas worth copying:

1. **One isolated compute sandbox per user** that holds agent + data + credentials.
2. **A second, independent "Sentinel" agent** that gates *every* egress request
   and connector action — defense against prompt injection (which Meta itself
   calls "an open problem").
3. **Credentials are injected by infrastructure, never shown to the model.**
4. **Human-in-the-loop approval** for scoped, sensitive actions.
5. **Durable background execution**, independent of the client session.

### The model: Muse Spark

Natively multimodal (text/image/audio) reasoning model with three modes:
**Instant** (fast), **Thinking** (extended CoT), **Contemplating** (multiple
reasoning agents in parallel, results merged). No public API for the consumer
product; Spark is available via Meta's Model API / Muse Code.

**We will not train a model.** Every approach below uses a hosted frontier model
(e.g. Claude Opus / Sonnet / Haiku 5.5 via Amazon Bedrock). Spark's modes map
cleanly:

| Muse Spark mode | Our equivalent |
|---|---|
| Instant | Small/fast model (Haiku), no extended thinking |
| Thinking | Large model with extended thinking enabled |
| Contemplating | Fan-out N parallel runs (sub-agents) + a judge/merge step |

---

## 2. Building blocks (Muse feature → AWS / OSS component)

Every approach is a different way of wiring the same ~12 blocks:

| # | Muse feature | Build it with |
|---|---|---|
| 1 | LLM / reasoning | Amazon Bedrock (Claude), model router by task type |
| 2 | Agent loop / planner | Claude Agent SDK, Strands Agents, or LangGraph |
| 3 | Long-term memory | Postgres + pgvector (facts, episodes, embeddings) or **Bedrock AgentCore Memory**; a "memory" UI to view/edit/delete |
| 4 | Own browser | Playwright + headless Chromium in a container, or **AgentCore Browser**; computer-use for hard sites |
| 5 | Connectors | **MCP** servers (Gmail, Calendar, Drive, Slack…), OAuth with per-scope consent; AgentCore Gateway/Identity |
| 6 | Credential vault | Secrets Manager + KMS; a tool-side proxy injects secrets so the model only sees a handle (`{{cred:amazon}}`) |
| 7 | Sentinel | Egress proxy (Squid/Envoy) + policy engine (allow-lists, OPA/Cedar) + a small LLM classifier for injection/exfil checks |
| 8 | Approvals | Step Functions `waitForTaskToken` / approval table + push / WhatsApp / Slack prompt |
| 9 | Background + scheduled tasks | EventBridge Scheduler, SQS, Step Functions (durable, resumable) |
| 10 | Payments | Stripe Issuing / Link single-use virtual cards, amount-locked |
| 11 | Audit trail | Append-only log: DynamoDB stream → S3 (Object Lock) + user-facing timeline |
| 12 | Channels | Web app, mobile push, WhatsApp Business API, Slack, email |
| + | Artifacts | Agent writes HTML/PDF to S3, served via CloudFront signed URLs |
| + | Observability | OpenTelemetry traces per agent step, CloudWatch, cost per user |

---

## 3. Approaches — simplest → production-ready

Overview first, details after.

| # | Approach | Isolation per user | Effort (1–2 eng) | Rough infra $/mo* | Good for |
|---|---|---|---|---|---|
| A | Single EC2, all-in-one | none (single user) | 1–2 wk | $30–80 | Personal prototype, demo |
| B | EC2 + Docker Compose | process / container | 2–4 wk | $80–200 | Team pilot (≤20 users) |
| C | Serverless + Bedrock AgentCore | managed microVM session | 3–6 wk | pay-per-use | Fast path to multi-user, small ops team |
| D | ECS Fargate, task-per-session | Fargate task (Firecracker) | 6–10 wk | $300–2k | Real beta (100s of users) |
| E | EKS + sandboxed pods | gVisor / Kata pod per user | 3–5 mo | $2k–10k+ | Production, 1k–100k users |
| F | E + Confidential compute | encrypted VM / Nitro Enclave | +2–3 mo | +30–50% | Privacy-as-a-feature ("Confidential VM") |

\* Infra only; **LLM tokens dominate cost** in every option (see §5).

---

### Approach A — Single EC2 "agent box" (simplest)

```
 User ──HTTPS──► EC2 (t3.large / m7i.large)
                 ├─ FastAPI/Node web UI + chat
                 ├─ Agent loop (Claude Agent SDK) ──► Bedrock
                 ├─ Playwright + Chromium (headless)
                 ├─ SQLite (+ sqlite-vec) memory
                 ├─ cron / APScheduler  (background tasks)
                 └─ MCP servers (gmail, calendar) as local processes
```

- **How**: one CDK stack — VPC, one EC2 in a public subnet behind an ALB (or
  CloudFront), instance role with `bedrock:InvokeModel`, secrets in Secrets
  Manager, EBS snapshot backup.
- **Sentinel**: none, or a simple domain allow-list in the tool layer.
- **Approvals**: agent pauses and posts a "Approve? [y/n]" message in the chat.

| Pros | Cons |
|---|---|
| Fastest to build; whole system in one place | Single user, single point of failure |
| Cheap; easy to debug (SSH in, watch the browser) | Agent, browser, and secrets share one machine — a prompt injection can reach everything |
| Validates the *product* (memory, tasks, connectors) before infra | Background jobs die with the instance; no horizontal scale |
| | Manual patching / ops |

**Use it to** answer "is the agent actually useful?" before investing in infra.

---

### Approach B — EC2 + Docker Compose (separated services)

```
                     EC2 (m7i.xlarge)  ── docker compose ──
 User ─► ALB ─► ┌──────────┐   ┌──────────────┐   ┌─────────────────┐
                │ api/web  │──►│ agent-worker │──►│ browser (per    │
                └────┬─────┘   │  (N replicas)│   │ task container) │
                     │         └──────┬───────┘   └────────┬────────┘
                ┌────▼────┐     ┌─────▼─────┐        ┌─────▼──────┐
                │  Redis  │     │ Postgres  │        │  sentinel  │──► internet
                │ (queue) │     │ +pgvector │        │ egress     │
                └─────────┘     └───────────┘        │ proxy      │
                                                     └────────────┘
```

- Split into containers: `api`, `agent-worker`, `browser`, `sentinel-proxy`,
  `postgres`, `redis`, `scheduler`.
- **Browser containers** have *no direct internet route*: their only network is
  an internal Docker network that reaches the `sentinel-proxy`, which enforces
  allow-lists and asks for approval on first-seen domains / POSTs with PII.
- Agent workers consume tasks from Redis → background tasks survive client disconnect.
- Credentials: worker calls a `vault` sidecar that fills form fields; the model
  only sees `{{cred:site}}` placeholders.

| Pros | Cons |
|---|---|
| Introduces the real Muse shape: agent ⟂ browser ⟂ sentinel ⟂ vault | Still one host; containers share a kernel (weak isolation for multi-tenant) |
| Same compose file runs locally and on EC2 | Manual scaling; DB on the same box (or move to RDS) |
| Cheap, simple, good for a 5–20 user pilot | Ops burden (patching, disk, backups) |
| Easy path to D/E: images are reused unchanged | No HA |

---

### Approach C — Serverless + Amazon Bedrock AgentCore (managed path)

AWS now sells most of the hard blocks as managed services — **AgentCore
Runtime** (per-session microVM isolation, long-running sessions), **Memory**,
**Browser**, **Code Interpreter**, **Gateway** (tools/MCP), **Identity**
(OAuth + credential vault), **Observability**.

```
 Web/Mobile/WhatsApp
        │
   API Gateway + Cognito
        │
   Lambda (session router) ──► AgentCore Runtime  (1 microVM per user session)
        │                         ├─ agent code (Strands / Claude Agent SDK)
        │                         ├─► AgentCore Memory     (long-term memory)
        │                         ├─► AgentCore Browser    (managed Chromium)
        │                         ├─► AgentCore Gateway ──► MCP / APIs / Lambda tools
        │                         └─► AgentCore Identity   (OAuth tokens, secrets)
        │
   Step Functions (long tasks, approvals via waitForTaskToken)
   EventBridge Scheduler (recurring / scheduled goals)
   DynamoDB (tasks, approvals, audit)  ·  S3 (artifacts)  ·  SNS/Pinpoint (push)
```

- **Sentinel**: implement as a Gateway interceptor / Lambda authorizer that
  every tool call passes through, plus browser network-policy allow-lists.
- **Background**: EventBridge Scheduler fires → Step Functions → invokes the
  agent session; result or approval request pushed to the user.

| Pros | Cons |
|---|---|
| Per-session microVM isolation without running a fleet | Vendor lock-in; behaviour bound by AgentCore limits (session length, regions, quotas) |
| Least ops: no servers, no patching, scales to zero | Per-use pricing can exceed self-hosting at high, steady volume |
| Memory / browser / OAuth vault are solved problems | Less control over the browser (stealth, extensions, residential IPs) |
| Fits this repo's serverless patterns | Harder to replicate "one persistent VM per user" semantics exactly |
| Very good **time-to-multi-user** | Newer service: fewer examples, evolving APIs |

**Best default if the goal is a working multi-user product with a small team.**

---

### Approach D — ECS Fargate, "task-per-session" sandboxes

Self-hosted version of C. Each active user session gets its **own Fargate task**
(Fargate tasks run in Firecracker microVMs → kernel-level isolation).

```
           ┌──────────────── control plane (ECS services) ────────────────┐
 Clients ─►│ ALB ─► api ─► session-manager ─► RunTask(per-user sandbox)   │
           │        │            │                                        │
           │        │      Step Functions (long-running goals, approvals) │
           │        │      EventBridge Scheduler (cron / triggers)        │
           └────────┼──────────────────────────────────────────────────────┘
                    │
    ┌───────────────▼───── user sandbox task (Fargate, private subnet) ─────┐
    │  agent container ─── browser container ─── credential-filler sidecar   │
    │       (no NAT route; only egress = sentinel service via PrivateLink)   │
    └────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
                   sentinel service (ECS) ─ policy + LLM classifier ─► NAT ─► internet
                                     │
           Aurora Postgres+pgvector (memory) · DynamoDB (tasks/audit)
           S3 per-user prefix + EFS access point (workspace) · Secrets Manager+KMS (per-user key)
```

- **Session lifecycle**: start task on first message/scheduled trigger, keep warm
  N minutes, snapshot workspace to S3/EFS, stop. Gives "persistent VM" feel
  without paying for idle.
- **Per-user KMS key / encryption context** for memory + credentials.
- **Sentinel** is a separate service in a separate security group; sandbox tasks
  have no NAT route, so it is physically impossible to bypass.

| Pros | Cons |
|---|---|
| Real per-user microVM isolation, fully under our control | Fargate cold start (≈20–60 s with Chromium image) → need warm pool |
| No cluster to manage; scales with RunTask | Custom session manager is non-trivial (warm pools, idle reaping, quotas) |
| Fits the ECS patterns already used in this repo | Fargate $ per vCPU-hr higher than EC2 at scale |
| Clean network enforcement of the Sentinel | No GPU, limited per-task customization (no custom kernel / nested virt) |

#### As built in `muse-test-4`

The implementation keeps the shape above (an isolated sandbox per user, a sentinel
it can't get around, a control plane that starts sandboxes on demand) and
simplifies it where a playground doesn't need the full design:

```
 Clients ─► CloudFront ─► internal ALB ─► api (UI · JSON API · session manager · scheduler)
                                            │ RunTask(MUSE_TOKEN) per user
                                            ▼
   isolated subnet (no NAT, no inbound) ── sandbox task: agent + Chromium
                                            │ the only peer: sentinel.muse.internal
                                            ▼
                     sentinel service ─ :8081 gateway (turns, tools, permits)
                                       ─ :3128 egress proxy ─► NAT ─► Bedrock, the web
                     DynamoDB (one table: turns · history · memories · tasks · approvals · audit · sandboxes)
```

| Doc design | As built | Why |
|---|---|---|
| Aurora Postgres + pgvector for memory | **DynamoDB**; Titan embeddings ranked by cosine in the sentinel | A user has few memories; no database to run or pay for while idle |
| Step Functions for long goals and approvals | **A turn queue in DynamoDB** (claimed transactionally); approvals use the "agent stops, user approves, asks again" pattern | One fewer service; no `waitForTaskToken` resume yet |
| EventBridge Scheduler | **A scheduler loop in the api** over a sparse `due` GSI; conditional writes make extra replicas safe | No per-task schedules to create and clean up |
| api pushes work to the sandbox | **The sandbox pulls** (long poll to the sentinel) | No inbound rules at all; no reaper, because an idle sandbox signs off and exits |
| Bedrock via a PrivateLink endpoint | **Model calls tunnel through the sentinel proxy** (TLS end to end) | Literally one way out of the sandbox; the same path works locally |
| agent ⟂ browser ⟂ credential-filler containers | **One container** (agent + headless Chromium) | Containers in a task share a network namespace, so splitting adds no isolation; no vault yet |
| EFS / S3 workspace snapshots | **A stateless sandbox**: history and memories come with each turn | Nothing to snapshot; a new sandbox picks up where the last left off |
| Per-user KMS key | **Not yet** | — |
| Sentinel = policy + LLM classifier | **Policy only**: per-user approvals, auto-allow, web ports, public IPs (connecting to the IP it checked) | Classifier left for later |
| Warm pool | **Not yet**: a cold start (image pull + boot) on the first message after an idle stop | Tune with `idleMinutes`; SOCI or a warm pool later |

The user is bound by infrastructure, not by the model. Each sandbox gets a fresh
`<user>.<random>` token, and the sentinel checks it against that user's
*current* sandbox record, so a replaced sandbox is locked out at once. Local
debugging runs the same image in docker compose, where sandboxes are containers
on an internal network with the sentinel as their only peer. See
`muse-test-4/README.md` for details and tests.

---

### Approach E — EKS production platform (sandboxed pods)

For 1k–100k users, more tenants, more control, better unit economics.

```
                       ┌───────────── EKS cluster ─────────────┐
 CloudFront+WAF ─► ALB │ ns: control                            │
                       │   api · session-controller (operator)  │
                       │   scheduler · approvals · notifier     │
                       │   memory-svc · connector-svc (MCP hub) │
                       │                                        │
                       │ ns: sentinel                           │
                       │   egress gateway (Envoy) + policy (OPA/│
                       │   Cedar) + injection classifier        │
                       │                                        │
                       │ ns: sandboxes  (RuntimeClass: gVisor / │
                       │   Kata-Firecracker on bare-metal nodes)│
                       │   pod per active user: agent+browser   │
                       │   NetworkPolicy: egress → sentinel only│
                       │   Karpenter: spot + on-demand pools    │
                       └────────────────────────────────────────┘
   Aurora (memory) · DynamoDB (tasks/audit) · S3 (artifacts/snapshots)
   Secrets Manager + KMS per tenant · Temporal/Step Functions (durable workflows)
   OTel → Grafana/CloudWatch · Langfuse-style LLM tracing · cost per user
```

Production concerns this approach is designed for:

- **Strong isolation**: gVisor or Kata Containers (Firecracker) RuntimeClass —
  plain containers are *not* enough when the workload is "LLM-driven code +
  browser executing attacker-controlled web pages".
- **Session controller** (Kubernetes operator / CRD `AgentSession`): warm pools,
  hibernate to S3, resume on trigger, per-user quotas.
- **Durable workflows**: Temporal (or Step Functions) for multi-day goals —
  retries, timers ("check price daily"), human-approval signals.
- **Model gateway**: routing (Haiku/Sonnet/Opus), prompt caching, rate limits,
  per-user budgets, fallbacks across regions.
- **Sentinel as a platform service**: every byte out goes through it; policies
  per connector scope; anomaly detection (sudden bulk email, new payee).
- **Evals + red-team pipeline**: prompt-injection test suites run in CI against
  every agent/prompt change.
- **Multi-AZ, multi-region**, blue/green for agent versions, GitOps (Argo CD).

| Pros | Cons |
|---|---|
| Best unit economics at scale (bin-packing, Spot, Karpenter) | Highest build + ops cost; needs a platform team |
| Full control: custom runtimes, kernels, GPUs, browser fleet tuning | Kata needs bare-metal / nested-virt nodes; gVisor has syscall compat gaps for Chromium tuning |
| Rich ecosystem (operators, service mesh, policy, observability) | Kubernetes security is easy to get subtly wrong |
| Portable across clouds | 3–5 months before it is genuinely "prod" |

---

### Approach F — Confidential compute ("Muse Confidential VM")

Meta's planned upgrade: encrypt the whole VM so *Meta itself* cannot read it.
On AWS:

- **EC2 with AMD SEV-SNP** (memory encryption) for the per-user sandbox host, or
- **Nitro Enclaves** holding the user's data key; KMS key policy only releases
  the key to an enclave with a matching **attestation** (PCR measurements).
- User-held key / passkey-wrapped data key → operators can't decrypt at rest.

| Pros | Cons |
|---|---|
| Strong, verifiable privacy story — a product differentiator | Complex: attestation, reproducible builds, key recovery UX |
| Limits blast radius of insider / operator access | LLM inference still leaves the enclave (Bedrock) — must be disclosed honestly |
| | Debugging & support much harder (can't look at user data) |

---

## 4. Side-by-side comparison

| | A EC2 | B Compose | C AgentCore | D ECS | E EKS | F Confidential |
|---|---|---|---|---|---|---|
| Users | 1 | ≤20 | 10–10k | 100–5k | 1k–100k+ | any |
| Per-user isolation | ✗ | weak | ✓ microVM | ✓ microVM | ✓ gVisor/Kata | ✓✓ encrypted |
| Sentinel enforced by network | ✗ | ✓ (single host) | partial | ✓ | ✓ | ✓ |
| Background tasks durable | ✗ | ~ | ✓ | ✓ | ✓ | ✓ |
| HA | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ |
| Ops burden | low | low-med | **lowest** | medium | high | very high |
| Build effort | **1–2 wk** | 2–4 wk | 3–6 wk | 6–10 wk | 3–5 mo | +2–3 mo |
| Lock-in | low | low | high | medium | low | medium |
| Cost at scale | n/a | n/a | med-high | medium | **lowest** | high |

---

## 5. Cost reality check

Infra is the small part. A Muse-like agent task (plan → browse 10–30 pages →
act) can be **50k–500k tokens**. Rough levers:

- **Model routing**: Haiku for browsing/extraction steps, Sonnet for planning,
  Opus/extended thinking only for hard steps; "Contemplating"-style fan-out only
  when the user opts in.
- **Prompt caching** for system prompt + tool schemas + memory snapshot.
- **Accessibility-tree / DOM-distilled browsing** instead of screenshots where possible.
- **Per-user budgets** enforced at the model gateway (explains Muse's free vs
  $20 / $100 tiers).

---

## 6. Security checklist (applies to B and up)

- [ ] Agent never sees raw secrets — infra injects credentials into the browser/tool.
- [ ] Sandbox has **no direct internet**; all egress via Sentinel.
- [ ] Sentinel is a *different* model/prompt/process than the agent (an injected
      agent can't talk it into anything it can't see).
- [ ] Connector scopes are least-privilege and user-visible (read vs send).
- [ ] Sensitive actions (send, pay, delete, share) require explicit approval
      with the concrete payload shown.
- [ ] Payments via single-use, amount-capped virtual cards.
- [ ] Immutable audit log, user-visible timeline of done + planned actions.
- [ ] Memory is viewable/editable/deletable; training opt-out.
- [ ] Prompt-injection red-team suite in CI.
- [ ] Per-user encryption keys; tenant data separation tested.

---

## 7. Recommended roadmap

| Phase | Approach | Goal | Exit criteria |
|---|---|---|---|
| 0 | **A** (1–2 wk) | Prove usefulness: memory + 2 connectors (Gmail, Calendar) + browser + scheduled task | 5 real tasks/week done end-to-end for 1 user |
| 1 | **B** or **C** (3–6 wk) | Multi-user pilot with Sentinel, vault, approvals, audit | 10–20 internal users, zero credential exposure in red-team |
| 2 | **D** (or stay on **C**) | Public beta, per-user microVM, durable workflows, budgets | p95 session start < 10 s, cost/user known |
| 3 | **E** | Production scale + unit economics | SLOs, multi-AZ, on-call, evals gate releases |
| 4 | **F** (optional) | Confidential compute as a differentiator | Attested enclaves, user-held keys |

**Recommendation:** Build **A** first in this project (`muse-test-1`) as a CDK
stack, then choose **C (AgentCore)** if we want speed and low ops, or **D (ECS)**
if we want control and to reuse our existing ECS patterns. Move to **E (EKS)**
only once usage justifies a platform team.

---

## 8. Open questions

1. Which model(s) and regions on Bedrock — latency vs. cost per step?
2. First connectors: Google Workspace, Slack, LINE/WhatsApp? (affects OAuth review timelines)
3. Do we allow purchases at all in v1, or read/draft-only actions?
4. Persistent per-user VM (Muse-style) vs. ephemeral session + snapshot?
5. Data residency / privacy requirements that would force Approach F early?

---

## References

- Meta Muse product page — https://ai.meta.com/muse/
- Introducing Muse (Meta newsroom, 2026-09) — https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/
- Meta Muse guide (Secure VM, Sentinel, Confidential VM) — https://www.digitalapplied.com/blog/meta-muse-personal-ai-agent-guide
- Muse Spark overview (reasoning modes, benchmarks) — https://www.datacamp.com/blog/muse-spark
- Meta Muse explained — https://www.kdnuggets.com/meta-muse-explained-what-it-is-how-it-works-and-what-it-can-do
- Muse Wonder (Active Memory / Active Focus, 2026-10-12) — https://kingy.ai/news/meta-muse-wonder-ai-models/
- Amazon Bedrock AgentCore — https://aws.amazon.com/bedrock/agentcore/
