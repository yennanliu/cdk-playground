# RAG System on AWS — Architecture Design

> Status: design only (no code yet). Target CDK stack: `RagStack1Stack`.
> Goal: a **simple, elegant** Retrieval-Augmented Generation system — upload documents through a UI, ask questions, get grounded answers with citations.

---

## 1. Design principles

- **Managed over hand-built.** Use Amazon Bedrock Knowledge Bases so we don't write our own chunking, embedding, or retrieval loop.
- **Serverless first.** No servers to patch or scale — S3, Lambda, API Gateway, Bedrock.
- **One data flow in, one query flow out.** Everything hangs off two simple pipelines.
- **Right-sized security.** Private buckets, least-privilege IAM. For the prototype, a **simple shared-password login** on the UI (no Cognito yet) — upgradeable later without touching the data flows.

---

## 2. Components at a glance

| Concern | AWS service | Why |
|---|---|---|
| Upload / Chat UI | S3 website bucket (static hosting) | Cheapest possible — no CDN/CloudFront to configure (dev/internal) |
| User auth *(prototype)* | Simple shared-password login in the UI | No managed identity service to set up; swap in Cognito later |
| Raw document storage | Amazon S3 (`docs` bucket) | Durable source of truth; KB data source |
| Ingestion trigger | Cron Lambda (EventBridge schedule → `sync` Lambda) | Familiar cron-job pattern; batches new docs on a timer |
| Chunking + embedding | Bedrock Knowledge Base | Managed; uses Titan/Cohere embeddings |
| **RAG DB (vector store)** | OpenSearch Serverless *(default)* or Aurora PostgreSQL + pgvector | Stores embeddings + metadata |
| Retrieval + generation | Bedrock `RetrieveAndGenerate` | One call: search + LLM answer + citations |
| Generation model | Claude on Bedrock via **inference profile** (default `global.anthropic.claude-sonnet-4-6`) | Newer models require an inference-profile ARN, not a foundation-model ARN |
| API | API Gateway (HTTP) → Lambda | Thin backend for upload URLs + queries |
| Observability | CloudWatch + X-Ray | Logs, metrics, tracing |

---

## 3. Architecture diagram

```
                          ┌───────────────────────────────────────────────┐
                          │                   Browser                       │
                          │  React/SPA (password login → upload docs + chat)│
                          └───────┬───────────────────────────┬────────────┘
                                  │ (static assets)            │ (HTTPS + shared token)
                                  ▼                            ▼
                        ┌──────────────────┐        ┌────────────────────────┐
                        │  S3 website       │        │   API Gateway (HTTP)   │
                        │  bucket           │        │   Lambda authorizer     │
                        │  (static hosting) │        │   (shared-secret check) │
                        └──────────────────┘        └───────────┬────────────┘
                                                                 │
                                        ┌────────────────────────┼───────────────────────┐
                                        ▼                        ▼                        
                             ┌────────────────────┐   ┌────────────────────────┐
                             │ Lambda: upload-url  │   │  Lambda: query          │
                             │ (presigned S3 PUT)  │   │  (RetrieveAndGenerate)  │
                             └─────────┬───────────┘   └───────────┬────────────┘
                                       │                           │
                     ┌─────────────────▼──────┐                    │
        INGESTION    │   S3 docs bucket        │                   │  QUERY
        FLOW  ──────▶│   (raw uploads)         │                   │  FLOW
                     └───────────┬─────────────┘                   │
                                 │                                 │
        ┌──────────────┐   ┌───────────────────┐│                    │
        │ EventBridge   │──▶│ Lambda: sync       ││ (KB reads bucket)  │
        │ schedule(cron)│   │ (StartIngestionJob)│┼───────────────────┼──►
        └──────────────┘   └───────────────────┘▼                    ▼
                       ┌───────────────────────────────────────────────────┐
                       │        Amazon Bedrock Knowledge Base               │
                       │  chunk → embed (Titan) → store & retrieve          │
                       │  ┌──────────────────────┐   ┌──────────────────┐   │
                       │  │  Vector store         │   │  Claude (Opus/    │  │
                       │  │  (OpenSearch          │   │  Sonnet) for      │  │
                       │  │   Serverless / pgvec) │   │  generation       │  │
                       │  └──────────────────────┘   └──────────────────┘   │
                       └───────────────────────────────────────────────────┘
```

---

## 4. The two flows

### 4.1 Ingestion flow (document → searchable knowledge)

1. User signs in with the shared password (UI stores the returned token) and picks a file.
2. UI calls `POST /upload-url`; the `upload-url` Lambda returns a **presigned S3 PUT URL** (browser uploads directly to S3 — bytes never pass through Lambda).
3. Upload lands in the **`docs` S3 bucket**, which is the Knowledge Base **data source**.
4. A **cron Lambda** — a small `sync` Lambda triggered by an EventBridge schedule (e.g. every N minutes) — calls `StartIngestionJob` on the Knowledge Base, batching up whatever new files have arrived since the last sync. (EventBridge is just the timer that fires the Lambda; Lambda has no built-in scheduler of its own. If you'd rather skip the Lambda entirely, EventBridge Scheduler can call `StartIngestionJob` as a direct target.)
5. Bedrock **chunks**, **embeds** (Amazon Titan Text Embeddings), and writes vectors + metadata to the **vector store**.

> Trade-off: newly uploaded docs become searchable only after the next scheduled sync (minutes, not seconds). If you later need near-instant availability, add back an `S3:ObjectCreated → Lambda` trigger that calls `StartIngestionJob` per upload.

### 4.2 Query flow (question → grounded answer)

1. UI sends `POST /query` with the user's question (shared token in the `Authorization` header).
2. API Gateway's Lambda authorizer checks the token, then invokes the **`query` Lambda**.
3. Lambda calls Bedrock **`RetrieveAndGenerate`** against the Knowledge Base:
   - retrieves top-K relevant chunks from the vector store,
   - passes them + the question to **Claude** (the configured inference-profile model),
   - returns a synthesized answer **plus citations** (source S3 URIs / chunk spans).
4. UI renders the answer and clickable source citations.

---

## 5. Choosing the RAG DB (vector store)

Bedrock Knowledge Bases can be backed by several vector stores. For "simple and elegant," two sensible choices:

| Option | Pros | Cons | Pick when |
|---|---|---|---|
| **OpenSearch Serverless** *(recommended default)* | Native Bedrock integration, zero DB management, scales automatically | Higher baseline cost (min OCUs) | You want the least ops and fastest setup |
| **Aurora PostgreSQL Serverless v2 + pgvector** | Lower cost at rest, familiar SQL, scales to near-zero | You manage schema/cluster, slightly more wiring | Cost-sensitive, or you already use Postgres |

Both store the same thing: an embedding vector per chunk + metadata (source URI, page/offset, timestamps). Start with **OpenSearch Serverless** for the cleanest path; switch to Aurora pgvector if the OpenSearch baseline cost matters.

---

## 6. Model choices (on Bedrock)

- **Embeddings:** Amazon Titan Text Embeddings v2 (managed by the Knowledge Base).
- **Generation:** Claude on Bedrock, invoked by `RetrieveAndGenerate` via an **inference-profile ARN** (default `global.anthropic.claude-sonnet-4-6`). Override the id with `-c modelId=...` (e.g. `jp.anthropic.claude-sonnet-4-6` for region-pinned inference) or the whole ARN with `-c modelArn=...`.

> **Two Bedrock gotchas we hit (validated the hard way):**
> 1. **Use an inference-profile ARN, not a foundation-model ARN.** Newer Claude models reject on-demand foundation-model invocation (`"on-demand throughput isn't supported"`); they must be called through an inference profile (`global.` / `apac.` / `jp.` prefix).
> 2. **Not every model has default KB prompt templates.** `anthropic.claude-opus-4-8`, for example, returns `"Custom prompt templates must be provided…"`. `sonnet-4-6` / `sonnet-4-5` / `haiku-4-5` work with the KB's default templates.
>
> Also ensure **model access is enabled** for the chosen model in the Bedrock console for the target region.

---

## 7. Security

- **UI auth (prototype):** a single shared password. The UI posts it to `POST /login`; the Lambda compares against a secret in Secrets Manager and returns a signed token the UI sends on later calls. API Gateway gates `/upload-url` and `/query` with a **Lambda authorizer** that validates that token. Enough to keep the endpoint from being wide open — **not** multi-user identity. When real users/roles are needed, replace the `/login` Lambda + authorizer with a Cognito user pool + JWT authorizer; the data flows don't change.
- **Buckets:** the `docs` bucket is fully private (uploads only via presigned URLs). The web bucket uses S3 static website hosting — its objects are public-read, so keep **only** built SPA assets there, never documents or secrets. (No CloudFront/HTTPS-on-custom-domain in this setup; acceptable for dev/internal. Re-add CloudFront + OAC when you need HTTPS, a custom domain, or a private origin.)
- **IAM:** least privilege — `upload-url` Lambda can only presign PUTs to the `docs` bucket; `query` Lambda can only call `bedrock:RetrieveAndGenerate` on the one Knowledge Base.
- **Encryption:** SSE-S3/KMS on buckets; TLS everywhere.
- **Secrets:** any DB credentials (Aurora option) in AWS Secrets Manager, injected as needed.
- **PII:** don't upload regulated data without reviewing retention; consider per-user prefixes + metadata filtering for tenant isolation.

---

## 8. Suggested CDK stack layout

Keep it in the single `RagStack1Stack` (or split into constructs) with these logical groups:

```
lib/
  rag_stack_1-stack.ts        # wires the constructs below
  constructs/
    storage.ts                # docs bucket (private) + web bucket (website hosting)
    knowledge-base.ts         # Bedrock KB + data source + vector store + cron (EventBridge → sync Lambda)
    api.ts                    # HTTP API + Lambda (shared-secret) authorizer
    functions/                # login, authorizer, upload-url, query, sync Lambdas
```

Deployment order matters: vector store → Knowledge Base → data source → Lambdas → API → UI.

> CDK support: Bedrock Knowledge Bases and OpenSearch Serverless are available via L1 (`Cfn*`) constructs in `aws-cdk-lib`, and via the `@cdklabs/generative-ai-cdk-constructs` L2 library (optional, higher-level). The current project pins `aws-cdk-lib ^2.260.0`.

---

## 9. Cost & scaling notes

- **Cheapest at rest:** Aurora Serverless v2 pgvector (scales down) + Lambda + S3.
- **Least ops:** OpenSearch Serverless (has a minimum capacity floor — budget for it).
- Generation cost scales with query volume and model tier — start on Sonnet if volume is high, Opus if quality matters most.
- Everything else (S3, Lambda, API Gateway, EventBridge) is effectively pay-per-use.

---

## 10. Build order (milestones)

1. **Storage** — `docs` bucket (private) + web bucket (website hosting).
2. **Knowledge Base** — vector store + Bedrock KB + S3 data source + cron `sync` Lambda (EventBridge schedule).
3. **Ingestion** — `upload-url` Lambda (presigned PUT); docs picked up by the cron `sync` Lambda.
4. **Query + simple auth** — `query` Lambda + HTTP API + `/login` + Lambda authorizer (shared password in Secrets Manager).
5. **UI** — minimal SPA (upload form + chat), deploy to web bucket.
6. **Polish** — citations rendering, CloudWatch dashboards, cost alarms.

---

## 11. Implementation status & deploy

**Status: implemented, deployed, and validated end-to-end.** The stack builds (`tsc`), synthesizes (`cdk synth`), passes its test, and was validated on a live deploy (ap-northeast-1): login/auth gate, presigned upload, cron ingestion, and a grounded `/query` answer with an S3 citation.

### Code layout (as built)

```
bin/rag_stack_1.ts              # entry point
lib/
  rag_stack_1-stack.ts          # wires constructs + UI deploy + config (context)
  constructs/
    fn.ts                       # shared NodejsFunction factory (esbuild-bundled)
    storage.ts                  # docs bucket (private) + web bucket (website hosting)
    knowledge-base.ts           # Bedrock KB + OpenSearch Serverless + S3 source + cron sync
    api.ts                      # HTTP API + shared-password auth + /login /upload-url /query
lambda/                         # handlers (bundled by esbuild, excluded from tsc)
  login.ts  authorizer.ts  upload-url.ts  query.ts  sync.ts
web/index.html                  # minimal SPA (login -> upload -> ask)
```

### Notable choices

- **`@cdklabs/generative-ai-cdk-constructs`** provides the L2 `bedrock.VectorKnowledgeBase` + `S3DataSource` — it creates the OpenSearch Serverless collection, the vector index (custom resource), and the KB role for us. This is what keeps the KB wiring elegant instead of ~200 lines of hand-rolled policies.
- **`NodejsFunction`** bundles the TypeScript Lambda handlers with esbuild — no separate `tsconfig.lambda.json` compile step. `tsc` is scoped to `bin`/`lib`/`test`; `lambda/` is excluded.
- **Auth:** `/login` mints a 12h HMAC token (signing key auto-generated into the app secret); the Lambda authorizer validates it. Stateless, no session store.

### Deploy

```bash
cdk bootstrap                          # once per account/region
cdk deploy -c appPassword=your-secret  # defaults to "change-me-dev" if omitted
```

Optional context overrides: `-c modelId=...` or `-c modelArn=...`.

### Pre-flight (required for it to work end-to-end)

1. **Enable Bedrock model access** in the target region — both Titan Text Embeddings v2 and the chosen Claude generation model, or ingestion/query fail at runtime.
2. **Generation model** — default is the `global.anthropic.claude-sonnet-4-6` **inference profile** (built as `arn:aws:bedrock:REGION:ACCT:inference-profile/global.anthropic.claude-sonnet-4-6`). The chosen model must (a) have model access enabled and (b) support the KB's default prompt templates. Override with `-c modelId=...` / `-c modelArn=...`. The query Lambda's IAM already permits `bedrock:InvokeModel` on `foundation-model/*` + `inference-profile/*` and `bedrock:GetInferenceProfile`.
3. **Docker must be running** at deploy — the KB construct bundles a Python custom-resource Lambda in Docker.

### Still prototype-grade (by design)

- Web bucket is **public-read** (assets only — never put docs/secrets there).
- Auth is a **single shared password**, not per-user identity.
- New uploads are searchable only after the next **cron sync** (default 15 min).

---

### TL;DR

Upload → S3 → (cron `sync` Lambda) → Bedrock Knowledge Base (chunk/embed into a vector store) → ask via API → `RetrieveAndGenerate` with Claude → grounded, cited answer. Data-flow Lambdas: `upload-url` + `query` + a cron `sync` (plus `login`/authorizer for the shared-password gate). One Knowledge Base, one UI, no CloudFront, no per-upload trigger. Managed services do the heavy lifting; we just wire them together.
```
