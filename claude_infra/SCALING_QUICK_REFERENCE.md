# Quick Reference: HA & Scalability

## 🎯 TL;DR

**Current System:**
- ✅ Infrastructure is HA (Multi-AZ)
- ❌ **NOT designed for concurrent multi-user access**
- ⚠️ Each user needs their own dedicated container
- 💰 Costs scale linearly: $60/user/month

## Critical Limitation

```
┌─────────────────────────────────────────────────────┐
│  ⚠️  FUNDAMENTAL ISSUE                              │
│                                                      │
│  code-server = 1 USER PER CONTAINER                 │
│                                                      │
│  ❌ User A + User B → Same Container = CONFLICTS    │
│  ✅ User A → Container 1, User B → Container 2      │
└─────────────────────────────────────────────────────┘
```

## HA Status Report Card

| Component | Grade | Status | Action Needed |
|-----------|-------|--------|---------------|
| **VPC** | A+ | Multi-AZ | None |
| **ALB** | A+ | Multi-AZ | None |
| **ECS** | A+ | Multi-AZ | None |
| **EFS** | A+ | Multi-AZ | None |
| **NAT Gateway** | D | Single AZ | 🔴 Add NAT to 2nd AZ |
| **Session Mgmt** | F | No stickiness | 🔴 Enable sticky sessions |
| **Multi-User** | F | Not supported | 🔴 Major redesign needed |

## Scalability Limits

### User Count vs Performance

```
Users   │ Performance  │ Action Required
────────┼──────────────┼──────────────────────────────────────
1-5     │ ✅ Excellent │ Current design OK
6-10    │ ⚠️  Degrading│ Add: Sticky sessions
11-20   │ 🔴 Slow      │ Add: Provisioned EFS throughput
21-50   │ 🔴 Very Slow │ Add: Per-user EFS access points
51+     │ 💥 Broken    │ Migrate to EKS or multi-tenant platform
```

### Bottleneck Matrix

```
Component       │ Bottleneck │ Limit        │ Impact
────────────────┼────────────┼──────────────┼─────────────────────
NAT Gateway     │ Bandwidth  │ 45 Gbps      │ ⚠️ OK for API calls
NAT Gateway     │ Single AZ  │ SPOF         │ 🔴 Add redundancy
EFS (Bursting)  │ I/O        │ 100 MB/s     │ 🔴 Slow at 20+ users
EFS (Baseline)  │ I/O        │ 50 KB/s/GB   │ 🔴 Terrible at scale
ALB             │ Requests   │ 25K/sec      │ ✅ No problem
Session Routing │ Stickiness │ None         │ 🔴 Users lose sessions
Cost            │ Linear     │ $60/user/mo  │ 🔴 Expensive at scale
```

## Cost by User Count

```
Users │ Containers │ Monthly Cost  │ Cost/User
──────┼────────────┼───────────────┼───────────
1     │ 1          │ $118          │ $118
5     │ 5          │ $358          │ $72
10    │ 10         │ $665          │ $67
20    │ 20         │ $1,265        │ $63
50    │ 50         │ $3,140        │ $63
100   │ 100        │ $6,240        │ $62

Note: With provisioned EFS (100 MiB/s): Add $600/month
```

## Quick Fix Checklist

### 🔥 Immediate (Today)

```bash
# 1. Enable sticky sessions
# Edit lib/claude-infra-stack.ts:
fargateService.targetGroup.enableCookieStickiness(
  cdk.Duration.hours(8)
);

# 2. Add 2nd NAT Gateway
# Edit lib/claude-infra-stack.ts:
const vpc = new ec2.Vpc(this, 'ClaudeVpc', {
  natGateways: 2,  // Changed from 1
});

# Cost: +$35/month
# Benefit: Eliminates SPOF
```

### ⚙️ Short-Term (This Week)

For 10+ users:

```typescript
// 3. Switch to Provisioned EFS
const fileSystem = new efs.FileSystem(this, 'ClaudeWorkspaceFS', {
  throughputMode: efs.ThroughputMode.PROVISIONED,
  provisionedThroughputPerSecond: cdk.Size.mebibytes(100),
});

// Cost: +$600/month
// Benefit: Consistent performance for 20-30 users
```

### 🏗️ Medium-Term (This Month)

For proper multi-user:

```typescript
// 4. Create EFS Access Point per user
function createUserEnvironment(userId: string) {
  const accessPoint = new efs.AccessPoint(this, `User${userId}AP`, {
    fileSystem: fileSystem,
    path: `/workspace/${userId}`,
    posixUser: { uid: `${1001 + parseInt(userId)}`, gid: `${1001 + parseInt(userId)}` },
  });

  // Launch dedicated ECS task for this user
  // Route via subdomain: user1.example.com
}

// Cost: $60 per active user
// Benefit: True multi-user support
```

## Architecture Options for Scale

### Option 1: Current + Improvements (10-20 users)

```
✅ Quick to implement
✅ Predictable costs
❌ Still expensive ($60/user)
❌ Manual user provisioning

Recommended if: Small team, budget OK
```

### Option 2: On-Demand Provisioning (20-50 users)

```
✅ 80% cost savings (only pay when active)
✅ Automatic cleanup
⚠️ 2-min startup time
❌ Requires orchestration layer

Recommended if: Users work in shifts
```

### Option 3: EKS Migration (50+ users)

```
✅ Better multi-tenancy
✅ Efficient resource usage
✅ Industry standard
❌ Complete rewrite
❌ More complex

Recommended if: Large team, long-term
```

### Option 4: SaaS Alternative (Any scale)

```
Consider:
- GitHub Codespaces
- GitPod Cloud
- AWS Cloud9
- Coder Enterprise

✅ No infrastructure management
✅ Built-in multi-user
❌ Less customization
❌ Vendor lock-in
```

## Real-World Scenarios

### Scenario A: 5 Developers, Full-Time

**Current Design: ✅ WORKS**

```
Cost: $358/month
Setup: Deploy as-is + sticky sessions
Performance: Excellent
```

### Scenario B: 25 Developers, Full-Time

**Current Design: ❌ DOESN'T WORK**

```
Problems:
- EFS performance degrades
- No user routing
- High cost ($1,575/month)

Solution: Option 1 + Provisioned EFS
Cost: $2,175/month
```

### Scenario C: 100 Developers, Part-Time (4h/day)

**Current Design: ❌ DOESN'T WORK**

```
Problems:
- Paying for 24/7 × 100 = $6,240/month
- Only using 4h/day (16% utilization)

Solution: Option 2 (On-Demand)
Cost: $1,000/month (84% savings!)
```

### Scenario D: 500+ Developers, Enterprise

**Current Design: ❌ NOT SUITABLE**

```
Solution: Option 3 (EKS) or Option 4 (SaaS)
Cost: Negotiate with AWS or use SaaS
```

## Decision Tree

```
How many users?
│
├─ 1-5 users
│  └─► Current design ✅
│      Cost: $118-358/month
│
├─ 6-20 users
│  └─► Current + sticky sessions + provisioned EFS ⚠️
│      Cost: $1,200-1,900/month
│
├─ 21-50 users
│  ├─► Full-time use?
│  │   └─► Option 3 (EKS)
│  │       Cost: ~$2,500/month
│  │
│  └─► Part-time use?
│      └─► Option 2 (On-Demand)
│          Cost: ~$1,000/month
│
└─ 51+ users
   └─► Option 3 (EKS) or Option 4 (SaaS)
       Cost: Depends on usage patterns
```

## Key Takeaways

1. **Infrastructure IS highly available** (Multi-AZ, redundant)
2. **Application is NOT multi-user ready** (fundamental limitation)
3. **EFS becomes bottleneck** at 10+ concurrent users
4. **Cost scales linearly** with user count
5. **Quick wins**: Sticky sessions + 2nd NAT Gateway
6. **For scale**: Need architectural changes (EKS or on-demand)

## Next Steps

**If you need multi-user support:**

1. Read full analysis: `HA_SCALABILITY.md`
2. Choose architecture option based on user count
3. Budget for costs (linear scaling)
4. Plan implementation timeline
5. Consider SaaS alternatives if 50+ users

**If single-user or small team (<5):**

1. Deploy current design
2. Add sticky sessions (5 min change)
3. Add 2nd NAT Gateway (5 min change)
4. You're good to go! ✅
