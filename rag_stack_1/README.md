# RAG on AWS (`RagStack1Stack`)

A **simple, elegant** Retrieval-Augmented Generation system on AWS: upload documents through a small web UI, ask questions, and get answers **grounded in your documents with citations**.

> Full design rationale and trade-offs live in [`doc/rag-architecture.md`](doc/rag-architecture.md). This README is the practical guide: what it is, how to deploy, use, and debug it.

---

## Core idea

Managed services do the heavy lifting; we just wire them together.

- **Amazon Bedrock Knowledge Base** owns the RAG core — chunking, embedding, vector storage, retrieval, and generation-with-citations. No hand-rolled retrieval loop.
- **Serverless throughout** — S3, Lambda, API Gateway, EventBridge. Nothing to patch or keep running.
- **Two flows only**: documents in, questions out.

## Architecture

```
   Browser (SPA: login -> upload -> ask)
        |                         |
   static assets            HTTPS + Bearer token
        v                         v
   S3 website bucket        API Gateway (HTTP) + Lambda authorizer
                                  |
              ┌───────────────────┼────────────────────┐
              v                   v                     
        Lambda: upload-url   Lambda: query
        (presigned PUT)      (RetrieveAndGenerate)
              |                   |
        S3 docs bucket            |
              |                   |
   EventBridge (cron) ─► Lambda: sync (StartIngestionJob)
              |                   |
              v                   v
        ┌─────────────────────────────────────────────┐
        │        Amazon Bedrock Knowledge Base         │
        │  chunk → embed (Titan) → store & retrieve    │
        │  vector store: OpenSearch Serverless         │
        │  generation: Claude (via inference profile)  │
        └─────────────────────────────────────────────┘
```

| Concern | Service |
|---|---|
| Upload / Chat UI | S3 website bucket (static hosting) |
| Auth (prototype) | Shared password → HMAC token → Lambda authorizer |
| Raw document storage | S3 (`docs` bucket, private) |
| Ingestion trigger | EventBridge cron → `sync` Lambda → `StartIngestionJob` |
| Chunk + embed + retrieve | Bedrock Knowledge Base (Titan Text Embeddings v2) |
| Vector store | OpenSearch Serverless (created by the CDK construct) |
| Retrieval + generation | Bedrock `RetrieveAndGenerate` → Claude via **inference profile** |
| API | API Gateway (HTTP) + Lambda |

## Design choices

- **`@cdklabs/generative-ai-cdk-constructs`** provides `bedrock.VectorKnowledgeBase` + `S3DataSource`, which create the OpenSearch Serverless collection, the vector index (custom resource), and the KB IAM role for us.
- **`NodejsFunction`** bundles the TypeScript Lambda handlers with esbuild — no separate compile step; `tsc` only builds `bin`/`lib`/`test`.
- **Stateless auth**: `/login` mints a 12h HMAC token (signing key auto-generated into the app secret); the authorizer validates it. No session store.
- **Prototype-grade by design**: the web bucket is public-read (assets only), auth is a single shared password (not per-user identity), and new uploads are searchable only after the next cron sync.

## Workflow

**Ingestion** — sign in → `POST /upload-url` returns a presigned S3 PUT → browser uploads directly to the `docs` bucket → an EventBridge cron fires the `sync` Lambda (default every 15 min) → Bedrock chunks, embeds, and indexes into the vector store.

**Query** — `POST /query` with the Bearer token → the `query` Lambda calls Bedrock `RetrieveAndGenerate` → retrieves top matches, passes them + the question to Claude → returns `{answer, citations}`.

## Project layout

```
bin/rag_stack_1.ts              # CDK app entry point
lib/
  rag_stack_1-stack.ts          # wires constructs + UI deploy + config (context)
  constructs/
    fn.ts                       # shared NodejsFunction factory (esbuild)
    storage.ts                  # docs bucket (private) + web bucket (website hosting)
    knowledge-base.ts           # Bedrock KB + OpenSearch Serverless + S3 source + cron sync
    api.ts                      # HTTP API + shared-password auth + routes
lambda/                         # handlers: login, authorizer, upload-url, query, sync
web/index.html                  # minimal SPA
doc/rag-architecture.md         # design document
```

---

## Prerequisites

- Node.js 20+ and the AWS CDK (`npm i -g aws-cdk` or use `npx cdk`).
- AWS credentials for the target account/region.
- **Docker running** — the KB construct bundles an index-creation custom resource in Docker at deploy time.
- **Bedrock model access enabled** in the target region for both the embeddings model (Titan Text Embeddings v2) and the generation model (a Claude model) — enable in the Bedrock console.

## Deploy

```bash
npm install
cdk bootstrap                              # once per account/region
cdk deploy -c appPassword=your-secret      # defaults to "change-me-dev" if omitted
```

Context overrides:

| Flag | Default | Purpose |
|---|---|---|
| `-c appPassword=...` | `change-me-dev` | UI login password |
| `-c modelId=...` | `global.anthropic.claude-sonnet-4-6` | Bedrock **inference-profile** id for generation |
| `-c modelArn=...` | built from `modelId` | Full model ARN override |

> **Model ARN must be an inference profile, not a foundation-model ARN.** Newer Claude models reject on-demand foundation-model invocation (`"on-demand throughput isn't supported"`). Region-pin with e.g. `-c modelId=jp.anthropic.claude-sonnet-4-6`, or use a `global.` / `apac.` profile. Also note some models (e.g. `claude-opus-4-8`) lack default KB prompt templates and return `"Custom prompt templates must be provided…"` — prefer `sonnet-4-6` / `sonnet-4-5` / `haiku-4-5`.

On success, the stack outputs: `ApiApiUrl`, `WebsiteUrl`, `AppSecretArn`, `DocsBucketName`, `KnowledgeBaseId`.

## Use it

Open the `WebsiteUrl` in a browser, or hit the API directly:

```bash
API=<ApiApiUrl output>

# 1. token
TOKEN=$(curl -s -X POST $API/login -H 'content-type: application/json' \
  -d '{"password":"change-me-dev"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# 2. upload (get presigned URL, then PUT the file)
URL=$(curl -s -X POST $API/upload-url -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"filename":"notes.txt","contentType":"text/plain"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["url"])')
curl -s -X PUT "$URL" -H 'content-type: text/plain' --data-binary @notes.txt

# 3. wait for the cron sync (<=15 min), or force ingestion now (see Debugging)

# 4. ask
curl -s -X POST $API/query -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"question":"..."}'
```

| Method + path | Auth | Body | Returns |
|---|---|---|---|
| `POST /login` | none | `{"password"}` | `{"token","expiresAt"}` |
| `POST /upload-url` | Bearer | `{"filename","contentType"}` | `{"url","key"}` |
| `POST /query` | Bearer | `{"question"}` | `{"answer","citations"}` |

The login password is stored in Secrets Manager (`AppSecretArn` output).

## Debugging

**Read a Lambda's logs:**
```bash
QFN=$(aws lambda list-functions --query "Functions[?contains(FunctionName,'QueryFn')].FunctionName" --output text)
aws logs tail "/aws/lambda/$QFN" --since 10m --format short
```
(Swap `QueryFn` for `LoginFn`, `AuthorizerFn`, `UploadUrlFn`, or `SyncFn`.)

**Force ingestion now** (instead of waiting for the cron):
```bash
SFN=$(aws lambda list-functions --query "Functions[?contains(FunctionName,'SyncFn')].FunctionName" --output text)
aws lambda invoke --function-name "$SFN" /dev/stdout --cli-binary-format raw-in-base64-out
# then poll the job:
KB=<KnowledgeBaseId>; DS=$(aws bedrock-agent list-data-sources --knowledge-base-id $KB --query 'dataSourceSummaries[0].dataSourceId' --output text)
aws bedrock-agent list-ingestion-jobs --knowledge-base-id $KB --data-source-id $DS \
  --query 'ingestionJobSummaries[0].{status:status,stats:statistics}'
```

**Common issues**

| Symptom | Cause / fix |
|---|---|
| `/query` 500, logs show `"Custom prompt templates must be provided…"` | Model has no default KB templates (e.g. `opus-4-8`). Use `sonnet-4-6` / `sonnet-4-5` / `haiku-4-5`. |
| `/query` 500, `"on-demand throughput isn't supported"` | Using a foundation-model ARN. Use an **inference-profile** ARN (`-c modelId=...`). |
| `/query` 500, `"...AWS Marketplace...subscription..."` | Model access not enabled in the Bedrock console for that region. |
| Query returns "no information found" right after ingestion | OpenSearch index refresh lag (~15–30s after job `COMPLETE`). Retry shortly. |
| `403` on `/upload-url` or `/query` | Missing/expired Bearer token — call `/login` again (tokens last 12h). |
| Deploy fails bundling the KB custom resource | Docker isn't running. |

## Destroy

```bash
cdk destroy
```
Both S3 buckets auto-empty and the OpenSearch Serverless collection is removed (stopping its baseline cost).

## Useful commands

* `npm run build`   compile TypeScript (bin/lib/test)
* `npm run test`    run jest tests
* `npm run clean`   remove compiled `*.js` / `*.d.ts`
* `cdk synth`       emit the CloudFormation template
* `cdk diff`        compare deployed stack with current code
* `cdk deploy`      deploy
* `cdk destroy`     tear down
