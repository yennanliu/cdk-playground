# LiteLLM AI Gateway on AWS — System Design & Architecture

A simple, production‑ready design for deploying the [LiteLLM Proxy Server](https://docs.litellm.ai/docs/simple_proxy) as a centralized **AI Gateway** on AWS.

## Table of Contents

1. [What & Why](#what--why)
2. [Core Components](#core-components)
3. [Reference Architecture](#reference-architecture)
4. [Deployment Options](#deployment-options)
5. [Configuration](#configuration)
6. [Security](#security)
7. [Scaling & Availability](#scaling--availability)
8. [Observability](#observability)
9. [Cost Considerations](#cost-considerations)
10. [Deployment Checklist](#deployment-checklist)

---

## What & Why

**LiteLLM Proxy** is an OpenAI‑compatible gateway that sits between your applications and 100+ LLM providers (OpenAI, Anthropic, AWS Bedrock, Azure, Gemini, self‑hosted…). One endpoint, one API format, central control.

**Why run it as a gateway:**

| Problem | LiteLLM solves it with |
| --- | --- |
| Every app hardcodes a different provider SDK | One **OpenAI‑compatible** `/v1/chat/completions` endpoint |
| No visibility into who spends what | **Virtual keys** + per‑key/user/team **spend tracking & budgets** |
| Provider outages break the app | **Load balancing + automatic fallbacks** across models |
| Uncontrolled usage / abuse | **Rate limits** (RPM/TPM) per key |
| Secrets scattered across services | Provider keys held **once**, in the gateway |
| No audit trail | Centralized **request/response logging** |

**Design principle:** the gateway is a *stateless* container. All state lives in managed AWS services (Postgres, Secrets Manager), so the compute layer scales horizontally and is disposable.

> **Simplicity note:** this design **omits Redis**. LiteLLM runs fine without it — you lose response caching and *global* rate limiting (limits become per‑replica/approximate instead of shared across tasks). For a small deployment that's a fine trade. Add ElastiCache later if you need exact, cluster‑wide rate limits or caching.

---

## Core Components

LiteLLM itself needs only a couple of things beyond the container:

| Component | Purpose | Required? |
| --- | --- | --- |
| **LiteLLM container** | The proxy. Docker image `ghcr.io/berriai/litellm`, listens on **port 4000** | ✅ |
| **PostgreSQL** | Virtual keys, teams, budgets, spend ledger, UI state, **UI‑managed provider keys** (encrypted) | ✅ (for keys/spend/UI) |
| **Master key** | Admin auth (`LITELLM_MASTER_KEY`, `sk-...`) | ✅ |
| **Salt key** | Encrypts provider credentials stored in the DB (`LITELLM_SALT_KEY`) | ✅ (if adding keys via UI/DB) |
| **`config.yaml`** | Model list, routing, fallbacks, settings — *can be minimal if you manage models in the UI* | ✅ |
| **Provider credentials** | API keys / IAM for upstream LLMs — via config, Secrets Manager, **or the Admin UI** | ✅ |
| ~~Redis~~ | ~~Shared cache + global rate limiting~~ — **omitted for simplicity** | ⬜ Optional |

Mapped to AWS managed services:

| LiteLLM need | AWS service |
| --- | --- |
| Run the container | **ECS Fargate** (serverless containers) |
| Ingress + TLS | **Application Load Balancer** + ACM cert |
| PostgreSQL | **Aurora PostgreSQL Serverless v2** (or RDS Postgres) |
| Secrets (master key, salt key, DB URL, provider keys) | **Secrets Manager** |
| Container image | **ECR** |
| LLM inference (in‑account) | **Amazon Bedrock** (via IAM role — no API keys) |
| Logs / metrics / alarms | **CloudWatch** |
| DNS | **Route 53** |
| ~~Redis cache / rate‑limit~~ | ~~ElastiCache~~ — *not deployed* |

---

## Reference Architecture

```
                            Internet / VPC clients
                                     │  HTTPS (443)
                                     ▼
                        ┌──────────────────────────┐
              Route53 ─▶ │  Application Load Balancer │  ACM TLS cert
                        │   (public or internal)     │  health check: /health/liveliness
                        └────────────┬───────────────┘
                                     │  :4000
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                        ▼      (private subnets)
        ┌───────────┐         ┌───────────┐            ┌───────────┐
        │ Fargate   │         │ Fargate   │   ...       │ Fargate   │   ECS Service
        │ LiteLLM   │         │ LiteLLM   │            │ LiteLLM   │   (auto-scaled)
        └─────┬─────┘         └─────┬─────┘            └─────┬─────┘
              │                     │                        │
   ┌──────────┴──────────┬──────────┴───────────┬───────────┴──────────┐
   ▼                     ▼                       ▼                      ▼
┌─────────────┐   ┌──────────────┐      ┌──────────────┐   ┌──────────────────┐
│  Aurora     │   │   Secrets    │      │  CloudWatch  │   │  LLM Providers    │
│  Postgres   │   │   Manager    │      │  Logs/Metrics│   │  ┌─────────────┐  │
│ keys/spend  │   │ master key,  │      │              │   │  │ Bedrock(IAM)│  │
│ + provider  │   │ salt, DB url │      │              │   │  │ OpenAI      │  │
│   keys(enc) │   │              │      │              │   │  │ Anthropic…  │  │
└─────────────┘   └──────────────┘      └──────────────┘   │  └─────────────┘  │
                                                            └──────────────────┘
   (No Redis — rate limits are per-replica/approximate; add ElastiCache to make them global)
```

**Request flow:** client → ALB (TLS) → Fargate task → LiteLLM authenticates the virtual key (checks Postgres) → applies budget & rate limit → routes to the best provider (with fallback) → streams response back → writes spend + logs.

**Networking:**
- ALB in public subnets (or internal, if gateway is VPC‑only).
- Fargate tasks and Aurora in **private subnets**.
- Outbound to external providers (OpenAI/Anthropic) via **NAT Gateway**; Bedrock reachable via IAM without leaving AWS (optionally a VPC endpoint).
- Security groups: ALB → tasks on 4000; tasks → Aurora 5432 only.

---

## Deployment Options

Pick by scale and ops appetite — all use the same container.

| Option | Best for | Trade‑offs |
| --- | --- | --- |
| **ECS Fargate + ALB** ⭐ | Most teams; production default | No servers to manage, easy autoscaling, fits this repo's ECS patterns |
| **EKS** | You already run Kubernetes | Most flexible, most operational overhead |
| **App Runner** | Smallest footprint / quick start | Simplest, less network control; still needs external Postgres |
| **EC2 + Docker Compose** | Dev / single‑node POC | Cheapest, but manual scaling & patching |

> **Recommendation:** **ECS Fargate + ALB + Aurora Serverless v2**. Serverless everywhere means it scales to load and down to near‑idle, with no host management — and with Redis omitted there's one less service to run.

---

## Configuration

### `config.yaml` (mounted or baked into the image)

```yaml
model_list:
  # In-account inference via Bedrock (no API key — uses the task IAM role)
  - model_name: claude-sonnet            # the name clients request
    litellm_params:
      model: bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0
      aws_region_name: us-east-1

  # External provider (key pulled from env → Secrets Manager)
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

  # Load-balance two deployments behind one name
  - model_name: gpt-4o
    litellm_params:
      model: azure/gpt-4o
      api_base: os.environ/AZURE_API_BASE
      api_key: os.environ/AZURE_API_KEY

litellm_settings:
  drop_params: true
  num_retries: 2
  request_timeout: 600
  # Route around failures automatically
  fallbacks: [{ "gpt-4o": ["claude-sonnet"] }]

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL   # enables virtual keys, spend, UI
  store_model_in_db: true                 # add models AND provider keys from the Admin UI
```

> **Minimal config:** because `store_model_in_db: true`, you can deploy with an almost‑empty `model_list` and add every model + provider key later in the UI (see below). No Redis, no `cache_params`.

### Required environment variables (from Secrets Manager)

```
LITELLM_MASTER_KEY   = sk-...                         # admin key + UI login
LITELLM_SALT_KEY     = sk-...                         # encrypts provider keys stored in the DB
DATABASE_URL         = postgresql://user:pass@aurora:5432/litellm
OPENAI_API_KEY, ANTHROPIC_API_KEY, ...               # optional — only if set via config, not UI
```

> `LITELLM_SALT_KEY` must stay **constant** for the life of the DB — rotating it makes previously stored provider keys undecryptable.

### Container run (what the Fargate task definition encodes)

```
Image:   ghcr.io/berriai/litellm:main-stable
Port:    4000
Command: --config /app/config.yaml --num_workers 4
Health:  GET /health/liveliness   (ALB target-group health check)
```

- **`--num_workers`** ≈ vCPU count per task; scale replicas horizontally for throughput.
- DB migrations run automatically on container start.
- **Admin UI** available at `/ui` (log in with the master key) for keys, teams, budgets, and spend dashboards.

### Adding models & provider API keys *after* deploy (via the UI)

**Yes — once the stack is deployed you can configure everything from the Admin UI**, no redeploy needed. This works because Postgres is attached and `store_model_in_db: true` is set.

1. Browse to `https://<gateway-endpoint>/ui` and log in with the **master key**.
2. Go to **Models → Add Model**: pick the provider (Bedrock, OpenAI, Anthropic, Azure…), choose a model, and paste the **provider API key** right there.
3. LiteLLM encrypts the key with `LITELLM_SALT_KEY` and stores it in Postgres — it's live for new requests immediately, across all replicas.

So the two ways to register providers are interchangeable:

| Method | When to use |
| --- | --- |
| **`config.yaml` / Secrets Manager** | Keys you want in version control / IaC; set at deploy time |
| **Admin UI** (DB‑stored, encrypted) | Ad‑hoc changes, self‑service, rotating keys without a redeploy |

> Bedrock is easiest of all: since the Fargate **task role** already has `bedrock:InvokeModel*`, you add a Bedrock model in the UI with **no key at all**.

---

## Security

- **No secrets in images or task defs** — inject `LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY`, `DATABASE_URL`, and any provider keys from **Secrets Manager** as ECS secrets.
- **TLS everywhere** — ACM cert on the ALB; enable in‑transit encryption on Aurora.
- **Virtual keys, never the master key** — issue scoped `sk-...` keys per app/team via `/key/generate` or the UI; master key is admin‑only.
- **Prefer IAM over API keys** — for Bedrock, give the Fargate **task role** `bedrock:InvokeModel*`; no long‑lived keys to rotate.
- **UI‑stored provider keys are encrypted** in Postgres with `LITELLM_SALT_KEY` — keep the salt key secret and constant.
- **Private data plane** — Aurora in private subnets, reachable only from the task security group.
- **Least‑privilege SGs** — ALB↔task on 4000; task↔DB only.
- **Rotate** the master key and provider keys via Secrets Manager rotation (but **never** the salt key once data exists).
- Optional: WAF on the ALB; internal‑only ALB if the gateway shouldn't face the internet.

---

## Scaling & Availability

- **Stateless tasks** → scale horizontally. ECS **target tracking** on CPU (~60%) or ALB `RequestCountPerTarget`; set `min=2` across 2+ AZs.
- **Rate limiting without Redis is per‑replica** — each task enforces limits independently, so the effective global limit ≈ per‑key limit × replica count (approximate). Fine for most cases; add **ElastiCache Redis** later if you need exact, cluster‑wide limits or response caching.
- **Aurora Serverless v2** auto‑scales ACUs with connection load; use a floor of 0.5 ACU for cost, ceiling sized to peak.
- **Availability:** 2+ AZs for ALB, tasks, and Aurora (Multi‑AZ).
- **Resilience in LiteLLM itself:** `num_retries`, `fallbacks`, and load‑balanced model groups keep serving during provider hiccups.
- **Startup:** allow generous health‑check grace so DB migrations finish before tasks are marked healthy.

---

## Observability

- **Container logs → CloudWatch Logs** (`awslogs` driver): every request, routing decision, and error.
- **Metrics:** LiteLLM exposes **Prometheus** metrics at `/metrics` (spend, latency, tokens, failures) — scrape with ADOT/Prometheus, or rely on ALB + ECS CloudWatch metrics for a lean setup.
- **Spend dashboards & audit:** built into the Admin UI, backed by Postgres.
- **Alarms:** ALB 5xx, target health, task CPU/memory, Aurora connections/ACU, Redis evictions.
- **Callbacks:** LiteLLM can push logs to Langfuse, Datadog, S3, etc. via `litellm_settings.success_callback` if you want richer tracing.

---

## Cost Considerations

Roughly, monthly cost = *idle floor* + *usage*. Keep the floor small:

| Item | Cost driver | Lever |
| --- | --- | --- |
| Fargate | vCPU/GB × task‑hours × replicas | Right‑size tasks; scale to `min=2`; Fargate Spot for non‑critical |
| Aurora Serverless v2 | ACU‑hours | Low ACU floor (0.5); it's mostly light OLTP |
| ~~ElastiCache~~ | — | **Not deployed** — omitted for simplicity |
| ALB | LCUs + hours | Single shared ALB |
| NAT Gateway | data processed | Only external providers traverse it; Bedrock stays in‑AWS |
| **LLM tokens** | provider usage | Usually the **dominant** cost — control with budgets and cheaper‑model fallbacks |

> The gateway infra is cheap relative to token spend. Its main financial value is **making token spend visible and enforceable** (budgets, routing to cheaper models). Dropping Redis trims one always‑on service from the bill.

---

## Deployment Checklist

1. **Network** — VPC with public + private subnets across 2 AZs, NAT Gateway.
2. **Data** — Aurora PostgreSQL Serverless v2 (private subnets). *(No Redis.)*
3. **Secrets** — put master key, salt key, and `DATABASE_URL` in Secrets Manager (provider keys optional — can be added in the UI).
4. **Image** — push/pull `ghcr.io/berriai/litellm:main-stable` (mirror to ECR).
5. **Config** — author a minimal `config.yaml` (`store_model_in_db: true`, optional fallbacks).
6. **Compute** — ECS Fargate service, task role with `bedrock:InvokeModel*`, secrets wired in, `min=2`.
7. **Ingress** — ALB + ACM cert + Route 53 record; health check `/health/liveliness`.
8. **Scale** — target‑tracking autoscaling on CPU / request count.
9. **Observe** — CloudWatch logs + alarms; optionally scrape `/metrics`.
10. **Configure in UI** — hit `/ui` with the master key, **add models + provider keys**, create per‑team virtual keys with budgets, hand them to apps.

---

### Client usage (any OpenAI SDK)

```python
from openai import OpenAI
client = OpenAI(
    base_url="https://gateway.example.com",   # the ALB / Route53 endpoint
    api_key="sk-team-virtual-key",            # a LiteLLM virtual key, not a provider key
)
resp = client.chat.completions.create(
    model="claude-sonnet",                    # a model_name from config.yaml
    messages=[{"role": "user", "content": "Hello"}],
)
```

The app never knows which provider served the request — that's the point of the gateway.
