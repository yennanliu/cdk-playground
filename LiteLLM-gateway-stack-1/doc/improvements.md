# Improvement Backlog

An honest read of the current stack (`lib/lite_llm-gateway-stack-1-stack.ts`)
against what a production-grade gateway wants. The deployed stack is a solid,
deliberately-simple POC; everything below is a gap between "works" and
"hardened". Grouped by theme, each item tagged **impact** / **effort** and
whether it matters for **POC** or only **prod**.

## Priority shortlist (do these first for prod)

1. **Turn on TLS** — currently plain HTTP by default (§Security).
2. **Scope the Bedrock IAM policy** off `Resource: "*"` (§Security).
3. **Pin / mirror the container image** off the mutable `main-stable` tag (§Supply chain).
4. **Subscribe something to the alarm topic** — alarms fire into the void today (§Observability).
5. **One NAT Gateway is a single point of failure** for egress (§Reliability).

---

## Security

- **[high / low — prod] TLS is off by default.** The ALB serves plain HTTP on
  `:80` unless a Route 53 zone is supplied, so master keys, virtual keys, and
  prompts travel in cleartext. For anything beyond a throwaway POC, deploy with
  `-c domainName/... ` or front it with an already-TLS-terminating ingress.
- **[high / low — both] Bedrock policy is `Resource: "*"`.** `bedrock:InvokeModel*`
  on all resources lets a compromised task invoke any model in the account.
  Scope to the specific model/inference-profile ARNs you actually serve.
- **[med / med — prod] No WAF on the public ALB.** Add `aws-wafv2` with rate-based
  rules + managed rule groups, or make the ALB internal (`publicLoadBalancer: false`)
  if the gateway shouldn't face the internet.
- **[med / low — prod] Aurora in-transit encryption not enforced.** Storage is
  encrypted (`storageEncrypted: true`) but the client connection uses a plain
  `postgresql://` URL. Require SSL on the DB and add `?sslmode=require` to
  `DATABASE_URL`.
- **[med / med — prod] No secret rotation.** Master key and DB credentials never
  rotate. Wire Secrets Manager rotation for both. **Never** the salt key.
- **[low / low — prod] DB deletion protection off.** With `RemovalPolicy.DESTROY`
  and no `deletionProtection`, a stray `cdk destroy` drops the database. Prod
  should use `SNAPSHOT`/`RETAIN` + `deletionProtection: true`.

## Supply chain / image

- **[high / low — both] Mutable image tag.** `ghcr.io/berriai/litellm-database:main-stable`
  is a moving target — a redeploy can silently pull a different build. Pin to a
  digest (`@sha256:...`) or a released version tag.
- **[med / med — prod] Pull straight from GHCR.** No caching or supply-chain
  control, and subject to GHCR rate limits. Mirror the image into ECR and pull
  from there (also faster in-region).

## Reliability & availability

- **[high / low — prod] Single NAT Gateway.** `natGateways: 1` means all
  outbound traffic (external providers, image pulls if not cached) dies if that
  one AZ has trouble. Use one NAT per AZ for prod.
- **[med / low — both] No deployment circuit breaker.** A bad task revision can
  roll forward and sit unhealthy. Enable
  `circuitBreaker: { rollback: true }` on the service so failed deploys auto-roll-back.
- **[med / med — prod] Rate limiting is per-replica (no Redis).** Effective global
  limit ≈ per-key limit × replica count, and it drifts as autoscaling changes
  the count. Add ElastiCache Redis for exact cluster-wide limits + response
  caching (this is a documented, deliberate omission — revisit when limits must
  be exact).
- **[low / low — prod] Autoscaling is CPU-only.** LiteLLM is I/O-bound waiting on
  providers; CPU may stay low while latency climbs. Add a target-tracking policy
  on ALB `RequestCountPerTarget`.

## Observability

- **[high / low — both] Nothing is subscribed to the alarm topic.** The alarms
  exist but notify an SNS topic with no subscriptions. Add an email/Slack/PagerDuty
  endpoint (could be a stack param).
- **[med / med — prod] Prometheus `/metrics` unused.** LiteLLM exposes rich
  per-model spend/latency/token/failure metrics that never leave the container.
  Scrape with ADOT → CloudWatch/AMP, or at least build a CloudWatch dashboard
  from the ALB/ECS metrics the stack already emits.
- **[low / med — prod] No request tracing / spend export.** Wire LiteLLM
  `success_callback` to Langfuse/Datadog/S3 for durable audit + tracing beyond
  the Postgres-backed UI.
- **[low / low — both] Log retention is one month, no metric filters.** Fine, but
  consider a metric filter on `ERROR`/`exit 137` → alarm for faster signal.

## Cost

- **[med / low — both] Everything is always-on.** Fargate `min=2`, Aurora floor
  0.5 ACU, and the NAT Gateway all bill 24/7 even at zero traffic. For non-prod,
  consider Fargate Spot for part of the capacity and a schedule that scales to
  zero off-hours.
- **[low / low — prod] NAT data-processing cost.** Only external-provider traffic
  should traverse NAT (Bedrock stays in-AWS). If you standardize on Bedrock, a
  VPC-endpoint-only egress posture can drop NAT almost entirely.

## Developer experience / correctness

- **[med / med — both] No integration test.** Tests are unit + snapshot only;
  nothing exercises a real deploy. The manual smoke test in
  [`debugging-and-testing.md`](debugging-and-testing.md) could be scripted into
  a post-deploy check.
- **[low / low — both] `enableExecuteCommand` is off.** Turning it on (behind a
  context flag) makes live debugging via `aws ecs execute-command` possible
  without a redeploy — see the debugging doc.
- **[low / low — both] `config/litellm-config.yaml` is dead weight.** It's not
  wired into the running container (the stack is config-less via
  `STORE_MODEL_IN_DB`). Either delete it or clearly keep it as the
  bake-into-image reference it already documents itself as.
- **[low / low — prod] Health-check grace is a fixed 180 s.** Works today, but if
  migrations grow it silently gets tight. Worth a comment/param rather than a
  magic number.

---

## Quick wins vs. bigger projects

| Quick wins (low effort, real value) | Bigger projects |
| --- | --- |
| Pin image digest | ElastiCache Redis for exact rate limits |
| Scope Bedrock IAM to model ARNs | WAF + internal ALB posture |
| Subscribe an endpoint to the alarm topic | ADOT/Prometheus metrics pipeline |
| `circuitBreaker: { rollback: true }` | Secret rotation for master + DB creds |
| Enforce Aurora SSL | Post-deploy integration test in CI |
| One NAT per AZ (prod) | Callback-based tracing (Langfuse/Datadog) |
