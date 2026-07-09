# LiteLLM AI Gateway (CDK / TypeScript)

Deploys the [LiteLLM proxy](https://docs.litellm.ai/docs/simple_proxy) as a centralized, OpenAI‑compatible **AI Gateway** on AWS:

```
VPC → Aurora PostgreSQL Serverless v2 → ECS Fargate + ALB (LiteLLM)
```

No Redis. Provider API keys and models are added in the LiteLLM Admin UI after deploy.

- **Design:** [`doc/litellm-gateway-aws-design-claude.md`](doc/litellm-gateway-aws-design-claude.md)
- **Implementation plan:** [`doc/litellm-gateway-implementation-claude.md`](doc/litellm-gateway-implementation-claude.md)
- **Debugging & testing:** [`doc/debugging-and-testing.md`](doc/debugging-and-testing.md)
- **Improvement backlog:** [`doc/improvements.md`](doc/improvements.md)
- **繁體中文:** [`README.zh-TW.md`](README.zh-TW.md)

## Commands

```bash
npm install
npm run lint     # tsc --noEmit (type-check)
npm run build    # compile
npm test         # unit + snapshot tests
npm run clean    # remove compiled *.js / *.d.ts from lib & bin
npx cdk synth
npx cdk deploy
```

## Deploy

```bash
# HTTP (POC) — reachable via the ALB DNS name
npx cdk deploy

# HTTPS (production) — auto-provisions ACM cert + Route 53 record + HTTP→HTTPS redirect
npx cdk deploy \
  -c domainName=gateway.example.com \
  -c hostedZoneId=Z0123456789ABCDEFGHIJ \
  -c zoneName=example.com
```

The stack, and every trackable resource in it (DB cluster, ECS cluster/service,
ALB, log group), is named `<appName>-<version>` — `litellm-gateway-v1` by
default. Override with `-c appName=... -c version=...`; **bump the version to
stand up a fresh, independently-named stack** alongside or in place of the old
one (see [Deployment notes](#deployment)):

```bash
npx cdk deploy -c version=v2
```

Stack outputs include `GatewayUrl`, `AdminUiUrl`, `MasterKeySecretArn`, and `AlarmTopicArn`.

## After deploy

1. **Get the master key.** It is `sk-` + the value in the `MasterKeySecretArn` secret:
   ```bash
   echo "sk-$(aws secretsmanager get-secret-value \
     --secret-id <MasterKeySecretArn> --query SecretString --output text)"
   ```
2. **Open the Admin UI** (`AdminUiUrl`) and log in with that master key.
3. **Add models + provider keys** under *Models → Add Model*. Bedrock needs no key (the task role has `bedrock:InvokeModel*`); OpenAI/Anthropic/etc. take a pasted key, encrypted in Postgres via the salt key.
4. **Create virtual keys** per app/team (with budgets/rate limits) and hand those `sk-...` keys to clients.
5. **Subscribe to alarms:** add an email/Slack endpoint to the SNS topic (`AlarmTopicArn`).

## Client usage (any OpenAI SDK)

```python
from openai import OpenAI
client = OpenAI(base_url="<GatewayUrl>", api_key="sk-team-virtual-key")
client.chat.completions.create(
    model="claude-sonnet",  # a model_name you configured in the UI
    messages=[{"role": "user", "content": "Hello"}],
)
```

## Development

- **Clean up compiled output.** `tsc` emits `*.js` / `*.d.ts` next to the sources in `lib/` and `bin/`. Run `npm run clean` before committing, or type-check without emitting via `npm run lint` (`tsc --noEmit`).
- **Snapshot tests gate structural changes.** `npm test` runs unit + snapshot tests; any change to the synthesized template fails the snapshot. Review the diff, then refresh with `npx jest -u` if the change is intended.
- **`config/litellm-config.yaml` is not wired in.** The container runs with `STORE_MODEL_IN_DB=True` and no `--config` — models/keys live in Postgres and are managed from the Admin UI. The YAML is a reference for teams who prefer to bake a config into a custom image instead.
- **Startup is a shell wrapper.** The task entrypoint assembles `DATABASE_URL` and `sk-`-prefixed master/salt keys from injected secrets at runtime, so no secret is ever baked into the task definition or image. If you change env/secret names, update `startupCommand` to match.

## Deployment

- **Versioned, disposable stacks.** Resources are named `<appName>-<version>`. Bump `-c version=v2` for a clean re-deploy (fresh DB/ECS/ALB with conflict-free names) and `npx cdk destroy -c version=v1` to tear the old one down — no half-renamed resources to chase.
- **First deploy is slow (~10–15 min).** Aurora provisioning dominates, and tasks run Prisma DB migrations at startup before passing health checks. The target group has a **180 s health-check grace period** for this — don't shorten it, or the first tasks get killed mid-migration.
- **Memory is set to 4 GB deliberately.** LiteLLM runs 2 uvicorn workers + a bundled Prisma engine; at 2 GB the container is OOM-killed (exit 137) before it goes healthy. Keep ≥4 GB with 1 vCPU.
- **HTTPS needs a Route 53 hosted zone you control.** All three of `domainName`, `hostedZoneId`, `zoneName` must be passed together; ACM cert validation blocks the deploy until the DNS record resolves. Without them the ALB serves plain HTTP on `:80`.
- **Salt key is immutable** — rotating `SaltKeySecret` makes stored provider keys undecryptable; it is `RemovalPolicy.RETAIN` and survives `cdk destroy` (delete it manually if you really mean to).
- **Dev vs prod** — the DB uses `RemovalPolicy.DESTROY` for dev; switch to `SNAPSHOT`/`RETAIN` for production.
- **No Redis** — rate limits are per‑replica/approximate. Add ElastiCache if you need exact, cluster‑wide limits or response caching (see the design doc).
