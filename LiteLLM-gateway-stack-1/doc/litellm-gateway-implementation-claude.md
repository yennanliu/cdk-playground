# LiteLLM AI Gateway — Implementation Plan (CDK / TypeScript)

Companion to [litellm-gateway-aws-design-claude.md](./litellm-gateway-aws-design-claude.md). This is the *how* — a phased plan to build the gateway with AWS CDK (TypeScript), including unit tests and CI.

**Guiding principle:** simple & elegant. One stack, managed serverless services, no Redis, provider keys added in the UI post‑deploy. Prefer high‑level CDK L2/L3 constructs (e.g. `ApplicationLoadBalancedFargateService`) over hand‑wiring.

## Table of Contents

1. [Target Architecture Recap](#target-architecture-recap)
2. [Project Layout](#project-layout)
3. [Implementation Phases](#implementation-phases)
4. [Testing Strategy](#testing-strategy)
5. [CI (GitHub Actions)](#ci-github-actions)
6. [Other Considerations](#other-considerations)
7. [Definition of Done](#definition-of-done)

---

## Target Architecture Recap

One CDK stack provisioning:

- **VPC** — 2 AZs, public + private subnets, 1 NAT Gateway.
- **Aurora PostgreSQL Serverless v2** — keys/spend/UI state, private subnets.
- **Secrets Manager** — master key, salt key, DB credentials.
- **ECS Fargate + ALB** — LiteLLM container on port 4000 (`ApplicationLoadBalancedFargateService`).
- **IAM task role** — `bedrock:InvokeModel*`.
- **CloudWatch** — logs + alarms.

No Redis. No ElastiCache. (See design doc for the trade‑off.)

---

## Project Layout

```
LiteLLM-gateway-stack-1/
├── bin/
│   └── lite_llm-gateway-stack-1.ts        # app entry (exists)
├── lib/
│   └── lite_llm-gateway-stack-1-stack.ts  # the stack (rewrite from SQS/SNS template)
├── config/
│   └── litellm-config.yaml                # minimal LiteLLM config (store_model_in_db: true)
├── test/
│   └── lite_llm-gateway-stack-1.test.ts   # fine-grained + snapshot tests
├── doc/                                   # these docs
├── package.json
├── cdk.json
└── tsconfig.json
```

Keep it a **single stack**. If it grows, extract L3 constructs (`NetworkConstruct`, `DatabaseConstruct`, `GatewayServiceConstruct`) into `lib/constructs/` — but start flat.

---

## Implementation Phases

### Phase 0 — Scaffolding & hygiene (½ day)
- Confirm `npm install` builds; replace the SQS/SNS placeholder in `lib/`.
- Add `clean` script (per repo CLAUDE.md) to strip compiled `*.js`/`*.d.ts` from `lib/` & `bin/`.
- Add `cdk-nag` (optional) for security best‑practice linting during synth.
- **Deliverable:** empty stack synths clean; `npm run build` + `npm test` green.

### Phase 1 — Network (½ day)
- `ec2.Vpc`: `maxAzs: 2`, `natGateways: 1`, public + `PRIVATE_WITH_EGRESS` subnets.
- Security groups: ALB SG (443 in), service SG (4000 from ALB SG), DB SG (5432 from service SG).
- **Deliverable:** VPC + SGs; unit test asserts subnet/NAT counts.

### Phase 2 — Data & secrets (1 day)
- `rds.DatabaseCluster` — Aurora PostgreSQL **Serverless v2** (`serverlessV2MinCapacity: 0.5`, `max: 4`), writer in private subnets, `storageEncrypted: true`.
- DB credentials → auto‑generated **Secrets Manager** secret.
- Two more secrets: `LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY` (generate once; salt key **must not** change later).
- **Deliverable:** cluster + secrets; test asserts engine, encryption, Serverless v2 scaling config.

### Phase 3 — Gateway service (1–2 days)
- `config/litellm-config.yaml` — minimal: `store_model_in_db: true`, `master_key`/`database_url` from env, optional Bedrock model + fallbacks.
- `ecs_patterns.ApplicationLoadBalancedFargateService`:
  - Image `ghcr.io/berriai/litellm:main-stable` (or mirror to ECR in‑stack).
  - Container port **4000**; command `--config ... --num_workers <n>`.
  - `secrets`: inject master key, salt key, `DATABASE_URL` (built from the DB secret) as ECS secrets.
  - `environment`: non‑secret config.
  - **Health check** on the target group: `/health/liveliness`, with a generous grace period (DB migrations run at boot).
  - `desiredCount: 2`.
- Task **role**: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`.
- Grant DB connect + secret read to the task role.
- **Deliverable:** service reachable via ALB DNS; `/ui` login works.

### Phase 4 — Scaling & observability (½ day)
- `service.autoScaleTaskCount({ min: 2, max: N })` + `scaleOnCpuUtilization(60%)`.
- Log group with retention (e.g. 1 month).
- CloudWatch alarms: ALB 5xx, unhealthy hosts, task CPU/mem, Aurora ACU/connections.
- `CfnOutput`: ALB URL, UI URL, secret ARNs.
- **Deliverable:** autoscaling policy + alarms present in synth; tests assert they exist.

### Phase 5 — Harden & document (½ day)
- TLS: ACM cert + HTTPS listener + Route 53 record (if a domain is available); otherwise HTTP for POC with a TODO.
- `RemovalPolicy`: `DESTROY` for dev; note `SNAPSHOT`/`RETAIN` for the DB in prod.
- Update README with deploy steps and the post‑deploy UI walkthrough.
- **Deliverable:** `cdk deploy` end‑to‑end; a virtual key created in UI serves a real request.

> Sequencing: 1 → 2 → 3 are strictly ordered (service needs DB + secrets). 4 and 5 can overlap.

---

## Testing Strategy

Use the CDK **`assertions`** module (`Template.fromStack`). Two layers:

### 1. Fine‑grained assertions (fast, intentional)
Assert the properties that matter, so tests document design decisions:

```ts
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LiteLlmGatewayStack1Stack } from '../lib/lite_llm-gateway-stack-1-stack';

test('provisions Aurora PostgreSQL, encrypted', () => {
  const app = new App();
  const stack = new LiteLlmGatewayStack1Stack(app, 'Test');
  const t = Template.fromStack(stack);

  t.hasResourceProperties('AWS::RDS::DBCluster', {
    Engine: 'aurora-postgresql',
    StorageEncrypted: true,
  });
});

test('Fargate service exposes port 4000 with health check', () => {
  const t = Template.fromStack(new LiteLlmGatewayStack1Stack(new App(), 'Test'));
  t.hasResourceProperties('AWS::ECS::Service', Match.objectLike({ DesiredCount: 2 }));
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', Match.objectLike({
    HealthCheckPath: '/health/liveliness',
    Port: 4000,
  }));
});

test('task role can invoke Bedrock', () => {
  const t = Template.fromStack(new LiteLlmGatewayStack1Stack(new App(), 'Test'));
  t.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: Match.arrayWith(['bedrock:InvokeModel']) }),
      ]),
    }),
  }));
});
```

**Suggested cases:** VPC has 2 AZs + 1 NAT · master/salt/DB secrets exist · ALB is internet‑facing (or internal) · secrets injected as ECS `Secrets`, not plaintext env · autoscaling policy present · **no** ElastiCache resource (guards the "simple" decision).

### 2. Snapshot test (catch unintended drift)

```ts
test('template snapshot', () => {
  const t = Template.fromStack(new LiteLlmGatewayStack1Stack(new App(), 'Test'));
  expect(t.toJSON()).toMatchSnapshot();
});
```

Run `npm test -- -u` to update deliberately after intended changes.

> Keep tests **synth‑only** — no AWS calls, no credentials. That's what makes them CI‑friendly and free.

---

## CI (GitHub Actions)

Matches the repo convention (see `.github/workflows/yt-stream-stack-1-ci.yml`): path‑filtered, per‑project workflow. Create `.github/workflows/litellm-gateway-stack-1-ci.yml` **at the repo root**:

```yaml
name: LiteLLM-gateway-stack-1 CI

on:
  push:
    branches: [main]
    paths:
      - 'LiteLLM-gateway-stack-1/**'
      - '.github/workflows/litellm-gateway-stack-1-ci.yml'
  pull_request:
    branches: [main]
    paths:
      - 'LiteLLM-gateway-stack-1/**'
      - '.github/workflows/litellm-gateway-stack-1-ci.yml'
  workflow_dispatch:

defaults:
  run:
    working-directory: LiteLLM-gateway-stack-1

jobs:
  ci:
    name: Lint / Build / Test / Synth
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: LiteLLM-gateway-stack-1/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Lint / type-check (tsc --noEmit)
        run: npx tsc --noEmit

      - name: Build
        run: npm run build

      - name: Unit tests
        run: npm test

      - name: CDK Synth (dry run)
        run: npx cdk synth
        env:
          AWS_DEFAULT_REGION: us-east-1
          AWS_ACCESS_KEY_ID: dummy
          AWS_SECRET_ACCESS_KEY: dummy
```

**Stages:** `tsc --noEmit` (lint/type‑check) → `build` → `test` (unit + snapshot) → `synth` (dry‑run, dummy creds — validates the template compiles to CloudFormation).

**Optional add‑ons:**
- **ESLint + Prettier** — add `eslint`/`@typescript-eslint` and a `lint` script for real linting beyond `tsc`; run before build.
- **cdk-nag** — fail CI on security anti‑patterns.
- **Dependabot** — keep `aws-cdk-lib` current.
- Deployment is intentionally **out of CI scope** (no cloud creds in CI). Deploy manually or via a separate, protected workflow with OIDC role assumption.

---

## Other Considerations

| Topic | Decision / note |
| --- | --- |
| **Container image** | Pin a tag (`main-stable`), don't use `latest`. Mirror to **ECR** in‑stack if you want to avoid GHCR pull‑rate/availability risk. |
| **DB migrations** | LiteLLM runs them at container start — set a generous ALB health‑check grace period so tasks aren't killed mid‑migration. |
| **Salt key immutability** | `LITELLM_SALT_KEY` must never change once provider keys are stored. Generate it once; consider `RemovalPolicy.RETAIN` on that secret. |
| **Secrets in CDK** | Use `Secret` + `ecs.Secret.fromSecretsManager`; never put keys in `environment` plaintext. Build `DATABASE_URL` from the DB secret's fields. |
| **Cost control** | Single NAT Gateway; Aurora min 0.5 ACU; Fargate `min=2`. Consider Fargate Spot for non‑prod. |
| **Removal policy** | Dev: `DESTROY`. Prod: DB `SNAPSHOT`/`RETAIN`, retain secrets. |
| **TLS / domain** | If no domain yet, ship HTTP POC and add ACM + Route 53 in Phase 5. Never expose the master key over plain HTTP in prod. |
| **Public vs internal ALB** | Internet‑facing for external clients; `internetFacing: false` if the gateway is VPC‑only (safer default). |
| **Region** | Pick a Bedrock‑enabled region matching your models; keep stack region‑agnostic via `env`. |
| **Compiled JS hygiene** | Per repo CLAUDE.md, run `clean` to remove `*.js`/`*.d.ts` from source dirs after building. |

---

## Definition of Done

- [ ] `lib/` stack replaces the SQS/SNS template with VPC + Aurora + Secrets + Fargate/ALB.
- [ ] `config/litellm-config.yaml` present, minimal, `store_model_in_db: true`.
- [ ] `npm run build` and `npx tsc --noEmit` pass clean.
- [ ] Unit tests (fine‑grained + snapshot) pass; assert Bedrock IAM, port 4000, health check, secrets‑as‑secrets, no ElastiCache.
- [ ] `npx cdk synth` succeeds with dummy creds.
- [ ] GitHub Actions CI workflow committed and green on PR.
- [ ] `cdk deploy` brings up a reachable `/ui`; a UI‑created virtual key serves a live request.
- [ ] README updated with deploy + post‑deploy UI steps.
