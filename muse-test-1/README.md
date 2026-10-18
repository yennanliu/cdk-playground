# muse-test-1 — a single-EC2 "agent box"

Approach A of [`doc/build-your-own-muse.md`](doc/build-your-own-muse.md): a
Meta-Muse-style personal AI agent on **one EC2 instance**. It's for a single
user, and its purpose is to find out whether the agent is actually useful
before we spend on anything bigger.

```
 you ──SSM tunnel──► EC2 (t3.medium, no inbound ports)
   localhost:8080     └─ docker: muse:local  (--network host, 127.0.0.1:8080)
                         ├─ FastAPI web UI + JSON API
                         ├─ agent loop ─────────────► Amazon Bedrock (Claude, Converse API)
                         ├─ tools: remember · recall · forget · browse · schedule_task
                         ├─ sentinel: browse only approved domains; never IMDS / private IPs
                         ├─ headless Chromium (Playwright)
                         ├─ scheduler thread (background tasks)
                         └─ SQLite /var/lib/muse/muse.db
                              memories · chat history · tasks · approvals · audit
```

| Muse feature (doc §2) | Here |
|---|---|
| Long-term memory, editable | `remember`/`recall`/`forget` tools; every memory goes into the system prompt; Memories panel |
| Own browser | `browse` → Playwright Chromium, rendered text |
| Sentinel + approvals | Unknown domain → approval request; user allows/denies in the UI; link-local (IMDS) and private addresses are always refused |
| Background tasks | `schedule_task` → SQLite; scheduler thread runs due tasks through the agent |
| Audit trail | Every tool call and approval is logged; Audit panel |
| Access | No ingress at all; SSM port forwarding is the only way in |

## Layout

```
bin/, lib/            CDK app (TypeScript): VPC, security group, IAM role, EC2, assets
assets/bootstrap.sh   host setup: docker build + systemd unit
app/                  the agent (Python, managed with uv)
  muse/               store · tools · agent · llm · browser · scheduler · api · static/index.html
  tests/unit/         one file per module, model + browser faked
  tests/integration/  API end-to-end, real Chromium, live Bedrock, deployed stack
scripts/e2e-test.sh   deployed tests through an SSM tunnel
test/                 CDK unit tests (Jest)
```

## Tests

TDD throughout: each feature has unit tests and an integration test.

| Command | What | Needs |
|---|---|---|
| `npm test` | CDK assertions (network, IMDSv2, IAM scope, user data, outputs) | — |
| `npm run test:app` | Python unit tests + API integration + real headless Chromium | `cd app && uv sync && uv run playwright install chromium` |
| `npm run test:live` | Agent against real Bedrock (uses `remember`, answers from memory) | AWS creds |
| `npm run test:e2e` | Deployed stack through an SSM tunnel: health, UI, memory, chat→Bedrock, sentinel | deployed stack, [session-manager-plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) |
| `npm run test:all` | `npm test` + `test:app` | |

## Deploy and use

```bash
npm install
npx cdk deploy                                   # ~8 min: the box builds the image on first boot
# optional: -c bedrockModelId=jp.anthropic.claude-haiku-5-5 -c allowedDomains=wikipedia.org,news.ycombinator.com

# copy the TunnelCommand output, then open http://localhost:8080
aws ssm start-session --target <instance-id> --document-name AWS-StartPortForwardingSession \
  --parameters portNumber=8080,localPortNumber=8080
```

Run locally without AWS infra (still calls Bedrock with your credentials):

```bash
cd app && uv sync && uv run playwright install chromium
MUSE_DB=./muse.db AWS_REGION=ap-northeast-1 uv run python -m muse.api
```

Shell on the box: `aws ssm start-session --target <instance-id>`, then
`journalctl -u muse -f` or `sudo docker logs -f muse`.

Config (`/etc/muse/muse.env`): `MUSE_MODEL_ID` (default
`global.anthropic.claude-sonnet-5-5`, an inference profile), `MUSE_ALLOWED_DOMAINS`,
`MUSE_SCHEDULER_SECONDS`.

## Known limits (by design, for Approach A)

- **One user, no login.** The tunnel is the authentication.
- **State resets on release.** A changed app or bootstrap replaces the instance
  (`userDataCausesReplacement`), and SQLite goes with it. Back up
  `/var/lib/muse/muse.db` first if you care about it.
- **The agent and its credentials share a host.** The sentinel checks URLs
  before Chromium loads them, but the container can still reach the instance
  role. Approach B and later separate the browser from the agent at the network level.
- **Simple memory search.** Keyword matching, no embeddings. That is fine at
  this scale, because every memory goes into the prompt anyway.
- No connectors (Gmail/Calendar), payments or push notifications yet.

Tear down: `npx cdk destroy MuseTest1Stack`.
