# Multi-User Architecture Design

## Overview

This design implements true multi-user support where each user gets:
- ✅ Dedicated container (no conflicts)
- ✅ Isolated workspace on EFS
- ✅ Personal password
- ✅ Own API key quota
- ✅ Automatic provisioning and cleanup

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Flow                                 │
└─────────────────────────────────────────────────────────────────┘

Step 1: User Registration/Login
    ┌──────────────┐
    │  Browser     │
    └──────┬───────┘
           │
           │ HTTPS: portal.example.com
           ▼
    ┌──────────────────────────────┐
    │  User Portal (S3 + Lambda)   │
    │  • Sign up / Login           │
    │  • Request environment       │
    └──────┬───────────────────────┘
           │
           │ Invoke
           ▼
    ┌──────────────────────────────┐
    │  Provisioning Lambda         │
    │  • Check DynamoDB            │
    │  • Create EFS Access Point   │
    │  • Launch ECS Task           │
    │  • Generate unique password  │
    │  • Save to DynamoDB          │
    └──────┬───────────────────────┘
           │
           │ Returns
           ▼
    ┌──────────────────────────────┐
    │  User Portal Response        │
    │  URL: user123.example.com    │
    │  Password: abc123xyz         │
    └──────────────────────────────┘


Step 2: Access code-server
    ┌──────────────┐
    │  Browser     │
    └──────┬───────┘
           │
           │ HTTPS: user123.example.com
           ▼
    ┌──────────────────────────────┐
    │  Application Load Balancer   │
    │  • Wildcard subdomain        │
    │  • Route to user's target    │
    └──────┬───────────────────────┘
           │
           │ Forward to specific task
           ▼
    ┌──────────────────────────────┐
    │  User's ECS Task             │
    │  • code-server               │
    │  • Claude Code CLI           │
    │  • User's password           │
    └──────┬───────────────────────┘
           │
           │ Mount
           ▼
    ┌──────────────────────────────┐
    │  User's EFS Access Point     │
    │  /workspace/user123          │
    └──────────────────────────────┘
```

## Component Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      AWS Infrastructure                         │
└────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│   Route53       │
│                 │
│ *.example.com   │──┐
│ portal.ex...com │  │
└─────────────────┘  │
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Application Load Balancer                                       │
│                                                                  │
│  Listeners:                                                      │
│  • HTTPS:443 (with ACM certificate)                             │
│  • HTTP:80 (redirect to HTTPS)                                  │
│                                                                  │
│  Rules:                                                          │
│  • portal.* → Lambda Portal                                     │
│  • user*.* → Dynamic Target Groups                              │
└─────────────────────────────────────────────────────────────────┘
                     │
      ┌──────────────┼──────────────┐
      │              │              │
      ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Target   │  │ Target   │  │ Target   │
│ Group 1  │  │ Group 2  │  │ Group 3  │
│          │  │          │  │          │
│ user1's  │  │ user2's  │  │ user3's  │
│ task     │  │ task     │  │ task     │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     │             │             │
     ▼             ▼             ▼
┌─────────────────────────────────────────┐
│         ECS Fargate Cluster             │
│                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────┐│
│  │ Task 1   │  │ Task 2   │  │ Task 3 ││
│  │ (user1)  │  │ (user2)  │  │ (user3)││
│  │          │  │          │  │        ││
│  │ code-    │  │ code-    │  │ code-  ││
│  │ server   │  │ server   │  │ server ││
│  └────┬─────┘  └────┬─────┘  └────┬───┘│
└───────┼─────────────┼─────────────┼────┘
        │             │             │
        │   Mount EFS │             │
        └─────────────┼─────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │  Amazon EFS                  │
        │                              │
        │  /workspace/                 │
        │  ├── user1/ (AP 1)          │
        │  ├── user2/ (AP 2)          │
        │  └── user3/ (AP 3)          │
        └─────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Supporting Services                                             │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  DynamoDB    │  │  Lambda      │  │  Secrets     │          │
│  │              │  │              │  │  Manager     │          │
│  │ • Users      │  │ • Provision  │  │              │          │
│  │ • Envs       │  │ • Cleanup    │  │ • Passwords  │          │
│  │ • Mapping    │  │ • Health Chk │  │ • API Keys   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Data Model

### DynamoDB Table: Users

```
Table: claude-users
Partition Key: userId (String)

Attributes:
{
  "userId": "user123",
  "email": "user@example.com",
  "createdAt": "2026-02-26T10:00:00Z",
  "status": "active",  // active, suspended, deleted
  "plan": "standard"    // free, standard, premium
}
```

### DynamoDB Table: Environments

```
Table: claude-environments
Partition Key: userId (String)
Sort Key: environmentId (String)

Attributes:
{
  "userId": "user123",
  "environmentId": "env-abc123",
  "status": "running",  // provisioning, running, stopped, terminating
  "taskArn": "arn:aws:ecs:...",
  "targetGroupArn": "arn:aws:elasticloadbalancing:...",
  "efsAccessPointId": "fsap-123456",
  "subdomain": "user123",
  "passwordSecretArn": "arn:aws:secretsmanager:...",
  "createdAt": "2026-02-26T10:00:00Z",
  "lastAccessedAt": "2026-02-26T11:30:00Z",
  "autoStopHours": 8,  // Auto-stop after 8 hours idle
  "resourceConfig": {
    "cpu": 2048,
    "memory": 4096
  }
}
```

## Routing Strategy

### Subdomain-Based Routing

```
User Registration:
  Email: alice@example.com
  → userId: alice (or generated: user-abc123)
  → Subdomain: alice.example.com

DNS Setup:
  *.example.com → ALB

ALB Routing:
  Host: alice.example.com → Target Group for alice
  Host: bob.example.com → Target Group for bob
```

### Implementation:
```typescript
// Lambda adds ALB listener rule dynamically
const rule = {
  Conditions: [
    {
      Field: 'host-header',
      Values: [`${userId}.example.com`]
    }
  ],
  Actions: [
    {
      Type: 'forward',
      TargetGroupArn: userTargetGroup.arn
    }
  ],
  Priority: calculatePriority(userId)
};
```

## Provisioning Flow

```
┌─────────────────────────────────────────────────────────────┐
│  User Requests Environment                                   │
└─────────────────────────────────────────────────────────────┘

1. Check DynamoDB
   ├─ Existing environment? → Return URL + password
   └─ No environment? → Provision new

2. Create EFS Access Point
   POST /2015-02-01/access-points
   {
     "FileSystemId": "fs-12345",
     "PosixUser": { "Uid": 1001+userIndex, "Gid": 1001+userIndex },
     "RootDirectory": {
       "Path": "/workspace/${userId}",
       "CreationInfo": {
         "OwnerUid": 1001+userIndex,
         "OwnerGid": 1001+userIndex,
         "Permissions": "755"
       }
     }
   }

3. Generate Password
   password = generateSecurePassword(32)
   secretArn = createSecret(userId, password)

4. Create Target Group
   targetGroup = new TargetGroup({
     Name: `user-${userId}`,
     VpcId: vpcId,
     Port: 8080,
     Protocol: 'HTTP',
     HealthCheck: { Path: '/healthz' }
   })

5. Add ALB Listener Rule
   rule = new ListenerRule({
     ListenerArn: albListenerArn,
     Conditions: [{ Field: 'host-header', Values: [`${userId}.example.com`] }],
     Actions: [{ Type: 'forward', TargetGroupArn: targetGroup.arn }],
     Priority: nextPriority++
   })

6. Launch ECS Task
   task = runTask({
     Cluster: clusterArn,
     TaskDefinition: codeServerTaskDef,
     LaunchType: 'FARGATE',
     NetworkConfiguration: { ... },
     Overrides: {
       ContainerOverrides: [{
         Name: 'code-server',
         Environment: [
           { Name: 'USER_ID', Value: userId },
           { Name: 'EFS_AP_ID', Value: accessPointId }
         ],
         Secrets: [
           { Name: 'PASSWORD', ValueFrom: secretArn }
         ]
       }]
     }
   })

7. Register Task with Target Group
   registerTargets({
     TargetGroupArn: targetGroup.arn,
     Targets: [{ Id: taskId, Port: 8080 }]
   })

8. Wait for Health Check
   waitUntil('healthy', { TargetGroupArn: targetGroup.arn })

9. Save to DynamoDB
   putItem({
     TableName: 'claude-environments',
     Item: { userId, environmentId, taskArn, targetGroupArn, ... }
   })

10. Return to User
    {
      "url": "https://alice.example.com",
      "password": "generated-password-here",
      "status": "ready"
    }
```

## Cleanup Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Auto-Cleanup (Scheduled Lambda every hour)                 │
└─────────────────────────────────────────────────────────────┘

1. Query DynamoDB
   environments = scan({
     FilterExpression: 'lastAccessedAt < :threshold AND status = :running',
     ExpressionAttributeValues: {
       ':threshold': now() - autoStopHours,
       ':running': 'running'
     }
   })

2. For each idle environment:
   a. Stop ECS Task
      stopTask({ Cluster: cluster, Task: taskArn, Reason: 'Idle timeout' })

   b. Deregister from Target Group
      deregisterTargets({ TargetGroupArn: tgArn, Targets: [{ Id: taskId }] })

   c. Delete Target Group
      deleteTargetGroup({ TargetGroupArn: tgArn })

   d. Delete ALB Listener Rule
      deleteRule({ RuleArn: ruleArn })

   e. Update DynamoDB
      updateItem({ Key: { userId }, UpdateExpression: 'SET status = :stopped' })

   f. Keep EFS Access Point (data persists!)
   g. Keep Secret (can reuse password)

3. Total downtime if stopped: 0 (just stopped, can restart)
   Restart time: ~2 minutes
```

## Cost Model

### Per-User Costs (Active 24/7)

```
Resource              Cost/User/Month
──────────────────────────────────────
ECS Fargate (2vCPU)   $60
Target Group          $0 (no per-TG cost)
ALB Rule              $0 (no per-rule cost)
EFS Access Point      $0 (free)
EFS Storage (10GB)    $3
Secret                $0.40
──────────────────────────────────────
TOTAL                 $63.40/user

Shared costs (divide by user count):
- NAT Gateway: $70/month
- ALB: $20/month
- Base EFS: $0
```

### Cost by User Count (24/7 Active)

```
Users │ Per-User Cost │ Shared Cost │ Total Monthly
──────┼───────────────┼─────────────┼──────────────
1     │ $63           │ $90         │ $153
5     │ $317          │ $90         │ $407
10    │ $634          │ $90         │ $724
20    │ $1,268        │ $90         │ $1,358
50    │ $3,170        │ $90         │ $3,260
```

### Cost with Auto-Stop (4h/day active)

```
Users │ Active Hours │ Compute Cost │ Total Monthly
──────┼──────────────┼──────────────┼──────────────
1     │ 120h         │ $10          │ $100
5     │ 120h each    │ $50          │ $140
10    │ 120h each    │ $100         │ $190
20    │ 120h each    │ $200         │ $290
50    │ 120h each    │ $500         │ $590

Savings: ~83% on compute costs!
```

## Security Model

### User Isolation

```
Layer 1: Network Isolation
  ├─ Each task in private subnet
  ├─ Security groups isolate container-to-container
  └─ Only ALB can reach tasks

Layer 2: File System Isolation
  ├─ Dedicated EFS Access Point per user
  ├─ POSIX permissions (UID/GID per user)
  └─ Can't access other users' /workspace

Layer 3: Authentication
  ├─ Unique password per user
  ├─ Stored in Secrets Manager
  └─ Injected at runtime

Layer 4: API Key Isolation
  ├─ Option A: Shared Claude API key (simple)
  └─ Option B: Per-user API keys (better tracking)

Layer 5: Container Isolation
  ├─ Fargate provides kernel-level isolation
  └─ No shared resources between tasks
```

### Access Control Matrix

```
Resource              User A    User B    Admin
────────────────────────────────────────────────
User A's container    ✅        ❌        ✅
User B's container    ❌        ✅        ✅
User A's /workspace   ✅        ❌        ✅
User B's /workspace   ❌        ✅        ✅
EFS root              ❌        ❌        ✅
DynamoDB (read)       Own only  Own only  ✅
DynamoDB (write)      Own only  Own only  ✅
```

## Scaling Strategy

### Horizontal Scaling

```
Users scale independently:
  User1: 1 container
  User2: 1 container
  User3: 1 container
  ...
  UserN: 1 container

Total containers = N users (when all active)
```

### Vertical Scaling (Per-User Tiers)

```
Free Tier:      1 vCPU, 2GB RAM  ($30/mo)
Standard Tier:  2 vCPU, 4GB RAM  ($60/mo)
Premium Tier:   4 vCPU, 8GB RAM  ($120/mo)
```

### Auto-Scaling Policy

```
Strategy: Start/Stop based on activity

Active:
  - User accessed in last 8 hours
  - Container running
  - Billed for compute

Stopped:
  - Idle for 8+ hours
  - Container stopped
  - EFS data persists
  - No compute charges

Restart:
  - User accesses URL
  - Lambda detects stopped state
  - Provisions new task (~2 min)
  - Mounts same EFS access point
  - User's files intact
```

## Implementation Phases

### Phase 1: Core Multi-User (MVP)
- ✅ DynamoDB tables
- ✅ Provisioning Lambda
- ✅ Dynamic EFS Access Points
- ✅ Per-user ECS tasks
- ✅ ALB routing rules
- ✅ Basic user portal

### Phase 2: Auto-Scaling
- ⏳ Cleanup Lambda (auto-stop)
- ⏳ Restart on access
- ⏳ Usage tracking
- ⏳ Cost reporting

### Phase 3: Enterprise Features
- ⏳ SSO integration
- ⏳ Team workspaces
- ⏳ Tiered pricing
- ⏳ Admin dashboard
- ⏳ Audit logs

## Technical Challenges & Solutions

### Challenge 1: ALB Rule Limits
**Problem:** ALB supports max 100 rules per listener
**Solution:**
- Phase 1: Subdomain routing (100 users max)
- Phase 2: Path-based routing with proxy (unlimited)
- Phase 3: Multiple ALBs (10,000+ users)

### Challenge 2: EFS Access Point Limits
**Problem:** 1000 access points per file system (soft limit)
**Solution:**
- Request limit increase (up to 10,000)
- Or: Multiple EFS file systems (1000 users each)

### Challenge 3: Cold Start Time
**Problem:** Provisioning takes ~2 minutes
**Solution:**
- Pre-warm idle containers
- Keep 5 "hot" containers ready
- Assign to new users instantly

### Challenge 4: Cost Optimization
**Problem:** 50 users × 24/7 = $3,260/month
**Solution:**
- Auto-stop after idle (83% savings)
- Fargate Spot (70% cheaper)
- Or: Pre-purchased Savings Plans

## Success Metrics

```
Metric                      Target
──────────────────────────────────────
Provisioning Time           < 2 minutes
Container Uptime            99.9%
User Isolation              100% (security)
Cost per User (active)      < $65/month
Cost per User (auto-stop)   < $15/month
Concurrent Users            50+ (Phase 1)
Total Users                 1000+ (Phase 2)
```

## Summary

This multi-user design provides:
- ✅ True user isolation (no conflicts)
- ✅ Automatic provisioning
- ✅ Cost-effective with auto-stop
- ✅ Scales to 50+ users (Phase 1)
- ✅ Secure (5 layers of isolation)
- ✅ Developer-friendly UX

Next: Implement Phase 1 (Core Multi-User MVP)
