# Debugging & Testing the Deployed LiteLLM Gateway

Practical runbook for poking at a live deployment — health checks, logs, the
API surface, the database, and the common failure modes we actually hit.

> Examples use the `v1` deploy in `ap-northeast-1`. Substitute your own values.

## 0. Set up shell variables

Pull everything you need straight from the stack outputs so nothing is
hard-coded:

```bash
STACK=litellm-gateway-v1
REGION=ap-northeast-1

BASE=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayUrl'].OutputValue" --output text)

MK_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='MasterKeySecretArn'].OutputValue" --output text)

# Actual master key = "sk-" + the raw secret value
MASTER_KEY="sk-$(aws secretsmanager get-secret-value --secret-id "$MK_ARN" \
  --region "$REGION" --query SecretString --output text)"

echo "$BASE"
```

Keep `MASTER_KEY` out of shell history and logs — it is admin-level.

## 1. Is it up? (health & reachability)

LiteLLM exposes two probes. Liveliness is unauthenticated (this is what the ALB
target group hits); readiness reports DB/connectivity state.

```bash
# ALB → task, no auth. 200 = task is serving.
curl -s -o /dev/null -w "liveliness=%{http_code}\n" "$BASE/health/liveliness"

# Deeper: DB connectivity, config load, etc.
curl -s "$BASE/health/readiness" | jq .

# Per-model health — prefer scoping to ONE model (see warning below).
curl -s "$BASE/health?model=claude-haiku-45" -H "Authorization: Bearer $MASTER_KEY" | jq .
```

> ⚠️ **Don't call bare `/health` blind.** It round-trips *every* configured
> model, and if one model group is failing (e.g. a retired Bedrock model), the
> per-model retries make the whole request hang — we've seen it block for 2+
> minutes and tie up workers. Always scope with `?model=<name>` when triaging,
> and only run the full `/health` when you know all models are healthy.

If liveliness fails, it's infra (task not running / ALB / SG) — go to logs
(§4) and ECS (§5). If liveliness passes but readiness fails, it's usually the
DB (§6).

## 2. What's configured?

```bash
# Models the gateway will serve (respects the caller's key scoping).
curl -s "$BASE/v1/models" -H "Authorization: Bearer $MASTER_KEY" | jq '.data[].id'

# Full model list + params (admin view).
curl -s "$BASE/model/info" -H "Authorization: Bearer $MASTER_KEY" | jq .
```

## 3. Exercise the API

### Virtual keys (do this, don't hand out the master key)

```bash
# Create a scoped key with a budget + rate limit.
curl -s "$BASE/key/generate" \
  -H "Authorization: Bearer $MASTER_KEY" -H "Content-Type: application/json" \
  -d '{"key_alias":"smoke-test","models":["claude-haiku-45"],"max_budget":5,"rpm_limit":60}' | jq .

VKEY=sk-...   # the "key" field from the response

# Inspect / list / delete
curl -s "$BASE/key/info?key=$VKEY" -H "Authorization: Bearer $MASTER_KEY" | jq .
curl -s "$BASE/key/list" -H "Authorization: Bearer $MASTER_KEY" | jq '.keys'
curl -s "$BASE/key/delete" -H "Authorization: Bearer $MASTER_KEY" \
  -H "Content-Type: application/json" -d "{\"keys\":[\"$VKEY\"]}" | jq .
```

### Chat completion (what the Playground calls under the hood)

```bash
curl -s "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $VKEY" -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-45","messages":[{"role":"user","content":"ping"}],"max_tokens":20}' | jq .

# Streaming (SSE)
curl -N "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $VKEY" -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-45","messages":[{"role":"user","content":"count to 5"}],"stream":true}'
```

### Negative tests (prove the guardrails)

```bash
# Unauthorized model for this key → 403
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $VKEY" -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'

# Bad key → 401
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/v1/models" -H "Authorization: Bearer sk-nope"
```

### Spend / usage

```bash
# Per-key spend — works on the OSS build.
curl -s "$BASE/key/info?key=$VKEY" -H "Authorization: Bearer $MASTER_KEY" | jq '.info.spend'
```

> ⚠️ **`/global/spend/report` is Enterprise-only.** On this OSS deployment it
> returns `You must be a LiteLLM Enterprise user to use this feature` (needs
> `LITELLM_LICENSE`). Use `/key/info` per key, or read spend from the Admin UI,
> which is backed by the same Postgres tables and works without a license.

The Admin UI (`$BASE/ui`) has the same data plus the Playground
(`$BASE/ui/playground/`) — log in with the master key, then paste a virtual key
into the API-key field to test as a client would.

## 4. Logs (CloudWatch)

Container stdout/stderr goes to log group `/ecs/litellm-gateway-v1`, stream
prefix `litellm`.

```bash
LOG_GROUP=/ecs/litellm-gateway-v1

# Tail live
aws logs tail "$LOG_GROUP" --region "$REGION" --follow --since 10m

# Filter for errors / OOM / DB issues
aws logs tail "$LOG_GROUP" --region "$REGION" --since 1h \
  --filter-pattern '?ERROR ?Exception ?Traceback ?"exit 137"'
```

What to look for:
- `Traceback` / `prisma` errors at startup → DB connectivity or migration (§6).
- `Invalid IPv6 URL` → a `DATABASE_URL` parse failure from an unsafe password char (should be fixed by the `excludeCharacters` set; see stack comment).
- Container exits with **137** → OOM. Memory is set to 4 GB for this reason; don't lower it.

## 5. ECS: is the task actually running?

```bash
CLUSTER=litellm-gateway-v1-cluster
SVC=litellm-gateway-v1-svc

# Desired vs running, deployment rollout state, recent events (very informative)
aws ecs describe-services --cluster "$CLUSTER" --services "$SVC" --region "$REGION" \
  --query "services[0].{desired:desiredCount,running:runningCount,pending:pendingCount,events:events[:5]}" | jq .

# Why did a task stop? stoppedReason is the key field.
TASK=$(aws ecs list-tasks --cluster "$CLUSTER" --region "$REGION" \
  --desired-status STOPPED --query "taskArns[0]" --output text)
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --region "$REGION" \
  --query "tasks[0].{stopped:stoppedReason,containers:containers[].{name:name,reason:reason,exit:exitCode}}" | jq .
```

Common `stoppedReason` values: health-check failures (task killed before it
finished migrating — check the 180 s grace period), OOM, or image pull errors.

### exec into a running task (deep debugging)

`enableExecuteCommand` is **not** enabled on the service by default. To get a
shell inside the container, redeploy with it on:

```ts
// in the stack, on the ApplicationLoadBalancedFargateService props:
// enableExecuteCommand: true,
```

```bash
aws ecs execute-command --cluster "$CLUSTER" --region "$REGION" \
  --task "$TASK_ID" --container web --interactive --command "/bin/sh"
```

Inside, you can check env (`echo $DATABASE_HOST`), hit `localhost:4000/health/liveliness`,
and confirm the assembled `DATABASE_URL` shape.

## 6. Database

The Fargate task is the only thing allowed into Aurora (SG-restricted), so you
can't connect from your laptop directly. Options:

- **Fastest signal:** `curl $BASE/health/readiness` — it reports DB health.
- **From inside the task:** exec in (§5) and use the bundled Prisma/psql tooling.
- **From your machine:** open a bastion or SSM port-forward into the VPC, or
  temporarily add your IP to the DB security group (remember to revoke).

DB credentials live in the auto-generated cluster secret:

```bash
aws secretsmanager get-secret-value --region "$REGION" \
  --secret-id $(aws rds describe-db-clusters --region "$REGION" \
    --db-cluster-identifier litellm-gateway-v1-db \
    --query "DBClusters[0].MasterUserSecret.SecretArn" --output text) \
  --query SecretString --output text | jq .
```

## 7. Alarms / metrics

```bash
# Which alarms are firing?
aws cloudwatch describe-alarms --region "$REGION" --state-value ALARM \
  --query "MetricAlarms[].AlarmName" --output table
```

The stack defines alarms for unhealthy hosts, ALB 5xx, service CPU/memory, and
DB connections, all wired to the `AlarmTopicArn` SNS topic. Subscribe an
email/Slack endpoint to actually receive them. LiteLLM also exposes Prometheus
metrics at `$BASE/metrics` if you want richer scraping.

## Quick triage table

| Symptom | First check | Likely cause |
| --- | --- | --- |
| `/health/liveliness` != 200 | ECS events (§5), logs (§4) | task crashed / not placed / SG |
| Liveliness OK, readiness fails | logs for `prisma`/DB | Aurora unreachable or mid-migration |
| Task loops, exit 137 | logs (§4) | OOM — keep memory ≥ 4 GB |
| First deploy tasks die | health-check grace period | migrations not done before probe |
| 401 on API | key value | wrong/expired key |
| 403 on API | key's `models` scope | model not allowed for that key |
| 5xx on chat calls | logs + provider health | provider key missing / Bedrock IAM / provider outage |
