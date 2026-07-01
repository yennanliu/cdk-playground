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
| Upload / Chat UI | S3 static site + CloudFront | Cheap, no servers, global CDN |
| User auth *(prototype)* | Simple shared-password login in the UI | No managed identity service to set up; swap in Cognito later |
| Raw document storage | Amazon S3 (`docs` bucket) | Durable source of truth; KB data source |
| Ingestion trigger | S3 Event → Lambda | Kicks off KB sync on upload |
| Chunking + embedding | Bedrock Knowledge Base | Managed; uses Titan/Cohere embeddings |
| **RAG DB (vector store)** | OpenSearch Serverless *(default)* or Aurora PostgreSQL + pgvector | Stores embeddings + metadata |
| Retrieval + generation | Bedrock `RetrieveAndGenerate` | One call: search + LLM answer + citations |
| Generation model | Claude on Bedrock (`anthropic.claude-opus-4-8`) | Highest quality; Sonnet for cost |
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
                        │   CloudFront      │        │   API Gateway (HTTP)   │
                        │   + S3 web bucket │        │   Lambda authorizer     │
                        │                   │        │   (shared-secret check) │
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
                                 │ S3:ObjectCreated               │
                                 ▼                                 │
                       ┌───────────────────┐                       │
                       │ Lambda: ingest     │                       │
                       │ (StartIngestionJob)│                       │
                       └─────────┬─────────┘                        │
                                 ▼                                  ▼
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
4. `S3:ObjectCreated` triggers the **`ingest` Lambda**, which calls `StartIngestionJob` on the Knowledge Base.
5. Bedrock **chunks**, **embeds** (Amazon Titan Text Embeddings), and writes vectors + metadata to the **vector store**.

> Simpler alternative: skip the `ingest` Lambda and run KB sync on a schedule (EventBridge every N minutes). Fewer moving parts, at the cost of ingestion latency.

### 4.2 Query flow (question → grounded answer)

1. UI sends `POST /query` with the user's question (shared token in the `Authorization` header).
2. API Gateway's Lambda authorizer checks the token, then invokes the **`query` Lambda**.
3. Lambda calls Bedrock **`RetrieveAndGenerate`** against the Knowledge Base:
   - retrieves top-K relevant chunks from the vector store,
   - passes them + the question to **Claude** (`anthropic.claude-opus-4-8`),
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
- **Generation:** Claude on Bedrock. IDs carry the `anthropic.` prefix on Bedrock:
  - `anthropic.claude-opus-4-8` — highest quality (default recommendation).
  - `anthropic.claude-sonnet-5` — strong quality at lower cost; good for high volume.
  - `anthropic.claude-haiku-4-5` — cheapest/fastest for simple Q&A.

> Note: Bedrock uses the `AnthropicBedrockMantle` client shape and `anthropic.`-prefixed model IDs. If we later call Claude directly (outside the KB `RetrieveAndGenerate` convenience) we'd use that client. For citation-grade grounding, prefer `RetrieveAndGenerate`, which wires retrieval + generation together for us.

---

## 7. Security

- **UI auth (prototype):** a single shared password. The UI posts it to `POST /login`; the Lambda compares against a secret in Secrets Manager and returns a signed token the UI sends on later calls. API Gateway gates `/upload-url` and `/query` with a **Lambda authorizer** that validates that token. Enough to keep the endpoint from being wide open — **not** multi-user identity. When real users/roles are needed, replace the `/login` Lambda + authorizer with a Cognito user pool + JWT authorizer; the data flows don't change.
- **Buckets:** both S3 buckets are private; web assets served only via CloudFront (OAC); uploads only via presigned URLs.
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
    storage.ts                # docs bucket + web bucket + CloudFront
    knowledge-base.ts         # Bedrock KB + data source + vector store
    api.ts                    # HTTP API + Lambda (shared-secret) authorizer
    functions/                # login, authorizer, upload-url, ingest, query Lambdas
```

Deployment order matters: vector store → Knowledge Base → data source → Lambdas → API → UI.

> CDK support: Bedrock Knowledge Bases and OpenSearch Serverless are available via L1 (`Cfn*`) constructs in `aws-cdk-lib`, and via the `@cdklabs/generative-ai-cdk-constructs` L2 library (optional, higher-level). The current project pins `aws-cdk-lib ^2.260.0`.

---

## 9. Cost & scaling notes

- **Cheapest at rest:** Aurora Serverless v2 pgvector (scales down) + Lambda + S3.
- **Least ops:** OpenSearch Serverless (has a minimum capacity floor — budget for it).
- Generation cost scales with query volume and model tier — start on Sonnet if volume is high, Opus if quality matters most.
- Everything else (S3, Lambda, API Gateway, Cognito) is effectively pay-per-use.

---

## 10. Build order (milestones)

1. **Storage** — buckets, CloudFront.
2. **Knowledge Base** — vector store + Bedrock KB + S3 data source.
3. **Ingestion** — `upload-url` + `ingest` Lambdas + S3 event.
4. **Query + simple auth** — `query` Lambda + HTTP API + `/login` + Lambda authorizer (shared password in Secrets Manager).
5. **UI** — minimal SPA (upload form + chat), deploy to web bucket.
6. **Polish** — citations rendering, CloudWatch dashboards, cost alarms.

---

### TL;DR

Upload → S3 → Bedrock Knowledge Base (chunk/embed into a vector store) → ask via API → `RetrieveAndGenerate` with Claude → grounded, cited answer. Two Lambdas, one Knowledge Base, one UI. Managed services do the heavy lifting; we just wire them together.
```
