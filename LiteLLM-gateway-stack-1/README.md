# LiteLLM AI Gateway (CDK / TypeScript)

Deploys the [LiteLLM proxy](https://docs.litellm.ai/docs/simple_proxy) as a centralized, OpenAI‑compatible **AI Gateway** on AWS:

```
VPC → Aurora PostgreSQL Serverless v2 → ECS Fargate + ALB (LiteLLM)
```

No Redis. Provider API keys and models are added in the LiteLLM Admin UI after deploy.

- **Design:** [`doc/litellm-gateway-aws-design-claude.md`](doc/litellm-gateway-aws-design-claude.md)
- **Implementation plan:** [`doc/litellm-gateway-implementation-claude.md`](doc/litellm-gateway-implementation-claude.md)

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

## Notes

- **Salt key is immutable** — rotating `SaltKeySecret` makes stored provider keys undecryptable; it is `RemovalPolicy.RETAIN`.
- **Dev vs prod** — the DB uses `RemovalPolicy.DESTROY` for dev; switch to `SNAPSHOT`/`RETAIN` for production.
- **No Redis** — rate limits are per‑replica/approximate. Add ElastiCache if you need exact, cluster‑wide limits or response caching (see the design doc).
