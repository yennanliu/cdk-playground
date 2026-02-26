# Claude Code Remote Development Environment - Architecture

## High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Internet                                    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 │ HTTPS/HTTP
                                 │
                    ┌────────────▼────────────┐
                    │    Developer Browser    │
                    │  (Chrome/Firefox/etc)   │
                    └────────────┬────────────┘
                                 │
                                 │ Password Authentication
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                           AWS Account                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                         VPC (ap-northeast-1)                      │  │
│  │                                                                    │  │
│  │  ┌──────────────────┐                 ┌──────────────────┐      │  │
│  │  │  Public Subnet   │                 │  Public Subnet   │      │  │
│  │  │    (AZ-A)        │                 │    (AZ-B)        │      │  │
│  │  │                  │                 │                  │      │  │
│  │  │  ┌────────────┐  │                 │  ┌────────────┐  │      │  │
│  │  │  │   ALB      │◄─┼─────────────────┼─►│   ALB      │  │      │  │
│  │  │  │ (Primary)  │  │                 │  │ (Standby)  │  │      │  │
│  │  │  └──────┬─────┘  │                 │  └────────────┘  │      │  │
│  │  └─────────┼────────┘                 └──────────────────┘      │  │
│  │            │                                                      │  │
│  │            │ Forward to Private Subnet                           │  │
│  │            │                                                      │  │
│  │  ┌─────────▼────────┐                 ┌──────────────────┐      │  │
│  │  │  Private Subnet  │                 │  Private Subnet  │      │  │
│  │  │    (AZ-A)        │                 │    (AZ-B)        │      │  │
│  │  │                  │                 │                  │      │  │
│  │  │  ┌────────────┐  │                 │  ┌────────────┐  │      │  │
│  │  │  │ ECS Task   │  │                 │  │ ECS Task   │  │      │  │
│  │  │  │ (Fargate)  │  │                 │  │ (Fargate)  │  │      │  │
│  │  │  │            │  │                 │  │            │  │      │  │
│  │  │  │  ┌──────┐  │  │                 │  │  ┌──────┐  │  │      │  │
│  │  │  │  │code- │  │  │                 │  │  │code- │  │  │      │  │
│  │  │  │  │server│  │  │                 │  │  │server│  │  │      │  │
│  │  │  │  │      │  │  │                 │  │  │      │  │  │      │  │
│  │  │  │  │Claude│  │  │                 │  │  │Claude│  │  │      │  │
│  │  │  │  │Code  │  │  │                 │  │  │Code  │  │  │      │  │
│  │  │  │  └──┬───┘  │  │                 │  │  └──┬───┘  │  │      │  │
│  │  │  └─────┼──────┘  │                 │  └─────┼──────┘  │      │  │
│  │  └────────┼─────────┘                 └────────┼─────────┘      │  │
│  │           │                                     │                 │  │
│  │           │         ┌───────────────────────────┘                 │  │
│  │           │         │                                             │  │
│  │           │         │  Mount EFS                                  │  │
│  │           ▼         ▼                                             │  │
│  │  ┌──────────────────────────────┐                                │  │
│  │  │    Amazon EFS                │                                │  │
│  │  │  (Elastic File System)       │                                │  │
│  │  │                              │                                │  │
│  │  │  /workspace                  │                                │  │
│  │  │  ├── project1/               │                                │  │
│  │  │  ├── project2/               │                                │  │
│  │  │  └── files persist here      │                                │  │
│  │  └──────────────────────────────┘                                │  │
│  │                                                                    │  │
│  │  ┌────────────┐                                                   │  │
│  │  │ NAT Gateway│─────► Internet (for Claude API calls)            │  │
│  │  └────────────┘                                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Supporting AWS Services                        │  │
│  │                                                                    │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │  │
│  │  │   Secrets    │  │  CloudWatch  │  │     ECR      │           │  │
│  │  │   Manager    │  │    Logs      │  │  (Docker     │           │  │
│  │  │              │  │              │  │   Registry)  │           │  │
│  │  │ • API Key    │  │ • Task Logs  │  │              │           │  │
│  │  │ • Password   │  │ • Debugging  │  │ • Image      │           │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ HTTPS API Calls
                                 │
                    ┌────────────▼────────────┐
                    │   Claude API            │
                    │   (Anthropic)           │
                    └─────────────────────────┘
```

## Component Interaction Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Request Flow                                      │
└─────────────────────────────────────────────────────────────────────────┘

1. USER ACCESSES CODE-SERVER
   ┌──────────┐
   │ Browser  │
   └────┬─────┘
        │
        │ 1. HTTP Request: http://alb-dns-name.amazonaws.com
        ▼
   ┌────────────────┐
   │ Load Balancer  │ ◄─── Health Check: /healthz every 30s
   └────┬───────────┘
        │
        │ 2. Forward to healthy task
        ▼
   ┌─────────────────────────┐
   │ ECS Task (code-server)  │
   │ Port 8080               │
   └─────────────────────────┘
        │
        │ 3. Prompt for password
        ▼
   ┌──────────┐
   │ Browser  │ ─── 4. User enters password from Secrets Manager
   └──────────┘


2. DEVELOPER WORKS IN CODE-SERVER
   ┌──────────────────────────┐
   │  code-server (VS Code)   │
   │                          │
   │  ┌────────────────────┐  │
   │  │  File Explorer     │  │
   │  │  /workspace        │◄─┼─── Mounted from EFS
   │  │                    │  │
   │  │  ├── project1/     │  │
   │  │  └── project2/     │  │
   │  └────────────────────┘  │
   │                          │
   │  ┌────────────────────┐  │
   │  │  Integrated        │  │
   │  │  Terminal          │  │
   │  │                    │  │
   │  │  $ claude "help"   │  │
   │  └────────────────────┘  │
   └──────────────────────────┘


3. CLAUDE CODE EXECUTION FLOW
   ┌──────────────────────────────────────────────────────────┐
   │ Developer types in terminal:                             │
   │ $ claude "write a Python function to sort a list"        │
   └────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
   ┌─────────────────────────────────────────────────────────┐
   │ Claude Code CLI reads:                                   │
   │ • ANTHROPIC_API_KEY from environment (Secrets Manager)   │
   │ • Current working directory (/workspace/project1)        │
   │ • Context from local files                               │
   └────────────────────┬────────────────────────────────────┘
                        │
                        │ HTTPS Request
                        ▼
   ┌─────────────────────────────────────────────────────────┐
   │ NAT Gateway                                              │
   │ (Routes traffic from private subnet to internet)         │
   └────────────────────┬────────────────────────────────────┘
                        │
                        │ HTTPS: api.anthropic.com
                        ▼
   ┌─────────────────────────────────────────────────────────┐
   │ Claude API (Anthropic)                                   │
   │ • Processes the prompt                                   │
   │ • Returns AI-generated response                          │
   └────────────────────┬────────────────────────────────────┘
                        │
                        │ Response
                        ▼
   ┌─────────────────────────────────────────────────────────┐
   │ Claude Code CLI                                          │
   │ • Displays response in terminal                          │
   │ • Can write files to /workspace (persisted to EFS)       │
   └──────────────────────────────────────────────────────────┘


4. FILE PERSISTENCE FLOW
   ┌──────────────────────────┐
   │  Developer saves file    │
   │  in /workspace/project1  │
   └────────────┬─────────────┘
                │
                │ Write operation
                ▼
   ┌─────────────────────────────────────────────────────────┐
   │ EFS Mount Point                                          │
   │ Container path: /workspace                               │
   │ EFS Access Point: uid=1001, gid=1001                     │
   └────────────┬────────────────────────────────────────────┘
                │
                │ NFS Protocol (Encrypted)
                ▼
   ┌─────────────────────────────────────────────────────────┐
   │ Amazon EFS (Elastic File System)                         │
   │ • Encrypted at rest                                      │
   │ • Automatically replicated across AZs                    │
   │ • Survives container restarts                            │
   └──────────────────────────────────────────────────────────┘

   When container restarts:
   ┌──────────────────────────┐
   │  New ECS Task starts     │
   └────────────┬─────────────┘
                │
                │ Mount EFS
                ▼
   ┌─────────────────────────────────────────────────────────┐
   │ Files are still there!                                   │
   │ /workspace/project1 with all your code                   │
   └──────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                      Data Flow Overview                           │
└──────────────────────────────────────────────────────────────────┘

USER INPUT
    │
    ├─► Code written in VS Code ──────► Saved to /workspace ──► EFS
    │                                   (persisted)
    │
    └─► Commands in terminal
            │
            ├─► Shell commands ────────► Executed in container
            │                            (ephemeral)
            │
            └─► Claude Code ───────────► API Call ──► Claude API
                                              │
                                              └─► Response ──► Terminal
                                                    │
                                                    └─► Can write to
                                                        /workspace (EFS)

SECRETS FLOW
    │
    ├─► API Key ──────► Secrets Manager ──► Injected as ENV var ──► Container
    │                                        (ANTHROPIC_API_KEY)
    │
    └─► Password ─────► Secrets Manager ──► Injected as ENV var ──► code-server
                                             (PASSWORD)

LOGS FLOW
    │
    └─► Container stdout/stderr ──► CloudWatch Logs ──► /ecs/dev-claude-code
                                     (7 day retention)
```

## Security Boundaries

```
┌──────────────────────────────────────────────────────────────────┐
│                      Security Layers                              │
└──────────────────────────────────────────────────────────────────┘

PUBLIC INTERNET
    │
    │ ┌─────────────────────────────────────┐
    └►│ Layer 1: Load Balancer              │
      │ • Public endpoint                    │
      │ • Can add WAF here                   │
      │ • Can add ACM certificate (HTTPS)    │
      └──────────────┬──────────────────────┘
                     │
      ┌──────────────▼──────────────────────┐
      │ Layer 2: Security Groups            │
      │ • ALB → ECS: Port 8080 only         │
      │ • ECS → Internet: Port 443 only     │
      │ • ECS ↔ EFS: Port 2049 only         │
      └──────────────┬──────────────────────┘
                     │
      ┌──────────────▼──────────────────────┐
      │ Layer 3: Network Isolation          │
      │ • ECS tasks in PRIVATE subnets      │
      │ • No direct internet access         │
      │ • NAT Gateway for outbound only     │
      └──────────────┬──────────────────────┘
                     │
      ┌──────────────▼──────────────────────┐
      │ Layer 4: Application Auth           │
      │ • code-server password required     │
      │ • Password in Secrets Manager       │
      └──────────────┬──────────────────────┘
                     │
      ┌──────────────▼──────────────────────┐
      │ Layer 5: Container Security         │
      │ • Non-root user (uid 1001)          │
      │ • Read-only root filesystem (can add)│
      │ • Limited capabilities               │
      └──────────────┬──────────────────────┘
                     │
      ┌──────────────▼──────────────────────┐
      │ Layer 6: IAM Permissions            │
      │ • Task role: Read secrets only      │
      │ • Task role: EFS mount only         │
      │ • Least privilege principle         │
      └──────────────┬──────────────────────┘
                     │
      ┌──────────────▼──────────────────────┐
      │ Layer 7: Data Encryption            │
      │ • EFS: Encrypted at rest            │
      │ • EFS: Encrypted in transit (TLS)   │
      │ • Secrets: Encrypted in SM          │
      └─────────────────────────────────────┘
```

## Auto-Scaling Behavior

```
┌──────────────────────────────────────────────────────────────────┐
│                   Auto-Scaling Workflow                           │
└──────────────────────────────────────────────────────────────────┘

NORMAL OPERATION
    ┌────────────────┐
    │  1 Task        │ ◄─── Desired Count: 1
    │  CPU: 40%      │      Min: 1, Max: 5
    └────────────────┘

HIGH LOAD
    ┌────────────────┐
    │  CPU: 85%      │ ◄─── CPU > 80% threshold
    └────────┬───────┘
             │
             │ CloudWatch Alarm triggers
             ▼
    ┌────────────────────────────────┐
    │  Application Auto Scaling      │
    │  Decision: Scale Out           │
    └────────┬───────────────────────┘
             │
             │ Wait 5 minutes (cooldown)
             ▼
    ┌────────────────┐  ┌────────────────┐
    │  Task 1        │  │  Task 2        │ ◄─── New task launched
    │  CPU: 45%      │  │  CPU: 40%      │
    └────────────────┘  └────────────────┘

LOW LOAD
    ┌────────────────┐  ┌────────────────┐
    │  CPU: 20%      │  │  CPU: 15%      │ ◄─── Both below 80%
    └────────┬───────┘  └────────────────┘
             │
             │ CPU < 80% for sustained period
             ▼
    ┌────────────────────────────────┐
    │  Application Auto Scaling      │
    │  Decision: Scale In            │
    └────────┬───────────────────────┘
             │
             │ Wait 10 minutes (cooldown)
             ▼
    ┌────────────────┐
    │  Task 1        │ ◄─── Back to 1 task
    │  CPU: 35%      │      Task 2 terminated
    └────────────────┘

Note: With EFS, all tasks share the same /workspace
      Users can reconnect to any task and see their files
```

## Container Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                   Container Lifecycle                             │
└──────────────────────────────────────────────────────────────────┘

STARTUP
    ┌─────────────────────────────────────────┐
    │ 1. ECS pulls Docker image from ECR      │
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ 2. Inject secrets from Secrets Manager  │
    │    • ANTHROPIC_API_KEY                   │
    │    • PASSWORD                            │
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ 3. Mount EFS to /workspace              │
    │    • Uses IAM authentication             │
    │    • TLS encryption in transit           │
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ 4. Start code-server process            │
    │    • Binds to 0.0.0.0:8080               │
    │    • Reads PASSWORD env var              │
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ 5. Health check succeeds                │
    │    • GET /healthz returns 200            │
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ 6. ALB marks target as healthy          │
    │    • Starts receiving traffic            │
    └──────────────────────────────────────────┘

RUNTIME
    ┌─────────────────────────────────────────┐
    │ • User connects and works                │
    │ • Files saved to /workspace (EFS)        │
    │ • Claude Code makes API calls            │
    │ • Logs streamed to CloudWatch            │
    └─────────────────────────────────────────┘

SHUTDOWN
    ┌─────────────────────────────────────────┐
    │ 1. SIGTERM signal sent                   │
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ 2. code-server graceful shutdown        │
    │    • Active sessions disconnected        │
    │    • 30 second grace period              │
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ 3. EFS unmounted                        │
    │    • Data persisted                      │
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ 4. Container terminated                  │
    └──────────────────────────────────────────┘

RESTART
    ┌─────────────────────────────────────────┐
    │ New container starts → Mounts same EFS   │
    │ → User reconnects → Files are there!     │
    └─────────────────────────────────────────┘
```

## Monitoring and Observability

```
┌──────────────────────────────────────────────────────────────────┐
│                   Monitoring Stack                                │
└──────────────────────────────────────────────────────────────────┘

METRICS (CloudWatch)
    │
    ├─► Container Insights
    │   ├── CPU Utilization (per task)
    │   ├── Memory Utilization
    │   ├── Network In/Out
    │   └── Task Count
    │
    ├─► ECS Service Metrics
    │   ├── Desired Count
    │   ├── Running Count
    │   ├── Pending Count
    │   └── Health Check Status
    │
    ├─► ALB Metrics
    │   ├── Request Count
    │   ├── Target Response Time
    │   ├── HTTP 2xx/4xx/5xx
    │   └── Healthy/Unhealthy Hosts
    │
    └─► EFS Metrics
        ├── Total I/O Bytes
        ├── Client Connections
        └── Throughput

LOGS (CloudWatch Logs)
    │
    └─► /ecs/dev-claude-code
        ├── code-server startup logs
        ├── User session logs
        ├── Claude Code execution logs
        └── Error traces

HEALTH CHECKS
    │
    ├─► Container Health Check
    │   └── curl localhost:8080/healthz
    │       Interval: 30s, Timeout: 5s
    │
    └─► ALB Target Health
        └── GET /healthz
            Interval: 30s, Timeout: 5s
            Healthy: 2 consecutive successes
            Unhealthy: 3 consecutive failures
```

## Cost Breakdown

```
┌──────────────────────────────────────────────────────────────────┐
│                   Monthly Cost Estimate                           │
│                   (ap-northeast-1, 24/7)                          │
└──────────────────────────────────────────────────────────────────┘

COMPUTE
    ECS Fargate (2 vCPU, 4GB)
    1 task × 730 hours × $0.082/hour ≈ $60/month

NETWORKING
    NAT Gateway
    1 gateway × 730 hours × $0.048/hour ≈ $35/month

    Application Load Balancer
    1 ALB × 730 hours × $0.027/hour ≈ $20/month

STORAGE
    EFS (assuming 10GB)
    10 GB × $0.30/GB-month = $3/month

LOGGING
    CloudWatch Logs (10GB)
    10 GB × $0.50/GB = $5/month

SECRETS
    Secrets Manager (2 secrets)
    2 × $0.40/secret = $0.80/month

TOTAL: ~$124/month

COST OPTIMIZATION
    Scale to 0 when not in use: -$60/month
    Use Fargate Spot: -$42/month (70% discount)
    Remove NAT (public subnet): -$35/month
    Smaller instance (1vCPU/2GB): -$30/month
```

## Disaster Recovery

```
┌──────────────────────────────────────────────────────────────────┐
│                   Disaster Recovery                               │
└──────────────────────────────────────────────────────────────────┘

SCENARIO 1: Task Failure
    ┌────────────────┐
    │  Task Crashes  │
    └────────┬───────┘
             │
             │ Health check fails
             ▼
    ┌─────────────────────────────┐
    │  ECS starts new task         │
    │  • Uses same EFS             │
    │  • Data preserved            │
    │  • ~60 seconds to recover    │
    └─────────────────────────────┘

SCENARIO 2: AZ Failure
    ┌────────────────┐
    │  AZ-A Down     │
    └────────┬───────┘
             │
             │ ALB detects unhealthy
             ▼
    ┌─────────────────────────────┐
    │  Traffic routes to AZ-B      │
    │  • EFS replicated            │
    │  • Data preserved            │
    │  • ~30 seconds to recover    │
    └─────────────────────────────┘

SCENARIO 3: Accidental Deletion
    ┌────────────────┐
    │  File Deleted  │
    └────────┬───────┘
             │
             │ No built-in recovery
             ▼
    ┌─────────────────────────────┐
    │  RECOMMENDATION:             │
    │  • Enable EFS backups        │
    │  • Use git for code          │
    │  • Regular snapshots         │
    └─────────────────────────────┘
```

## Summary

This architecture provides:

✅ **Scalability**: Auto-scales from 1-5 instances based on load
✅ **Persistence**: EFS ensures data survives container restarts
✅ **Security**: Multi-layer security with secrets management
✅ **High Availability**: Multi-AZ deployment with ALB
✅ **Observability**: CloudWatch metrics and logs
✅ **Cost-Effective**: Serverless compute with Fargate
✅ **Developer-Friendly**: Full VS Code experience in browser
✅ **AI-Powered**: Claude Code CLI pre-installed and ready

The system is production-ready but can be enhanced with:
- HTTPS/SSL certificates
- Custom domain names
- OAuth2 authentication
- Automated backups
- Advanced monitoring/alerting
- CI/CD pipeline for updates
