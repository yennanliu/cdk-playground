# Which Stack Should You Deploy?

You have **two deployment options** for Claude Code on AWS:

## Option 1: Single-User Stack (Original)

**Best for:** Personal use, 1-5 users max, simple setup

```bash
npx cdk deploy
```

### ✅ Advantages
- Simple setup (10 minutes)
- Lower cost ($118/month)
- No DNS configuration needed
- Easier to understand

### ❌ Limitations
- Only 1 active user at a time
- No user isolation
- Manual provisioning
- Not suitable for teams

### Cost
```
$118/month (24/7)
├─ Fargate: $60
├─ NAT Gateway: $35
├─ ALB: $20
└─ EFS + Logs: $3
```

### Documentation
- `README.md` - Getting started
- `CLAUDE.md` - Quick reference
- `DEPLOYMENT_GUIDE.md` - Step-by-step

---

## Option 2: Multi-User Stack (New!)

**Best for:** Teams, multiple users, production environments

```bash
# Install Lambda dependencies
cd lambda/provisioning && npm install && cd ../..
cd lambda/cleanup && npm install && cd ../..

# Deploy
npx cdk deploy -c multiUser=true
```

### ✅ Advantages
- Unlimited users (scales to 100+)
- Complete user isolation
- Automatic provisioning (API/portal)
- Per-user containers & workspaces
- Auto-cleanup (cost savings)
- Subdomain routing (user.example.com)

### ❌ Complexity
- Requires DNS setup (wildcard *.example.com)
- More components to manage
- Higher base cost
- 20-minute initial deployment

### Cost
```
Base: $153/month + $63 per additional user (24/7)

Or with auto-stop (4h/day avg):
Base: $96/month + $10.50 per user (83% savings!)

Example:
10 users, 24/7: $726/month
10 users, 4h/day: $201/month
```

### Documentation
- `MULTI_USER_DESIGN.md` - Architecture
- `MULTI_USER_DEPLOYMENT.md` - Complete guide
- `IMPLEMENTATION_SUMMARY.md` - Summary
- `HA_SCALABILITY.md` - Scalability analysis

---

## Decision Tree

```
How many users will access Claude Code?

├─ Just me (1 user)
│  └─► Single-User Stack ✅
│     Simple, cheap, quick
│
├─ 2-5 users, not at the same time
│  └─► Single-User Stack ✅
│     Coordinate access, shared environment
│
├─ 2-10 users, concurrent access needed
│  └─► Multi-User Stack ✅
│     True isolation, auto-provisioning
│
└─ 10+ users
   └─► Multi-User Stack ✅
      Scales well, cost-effective with auto-stop
```

## Feature Comparison

| Feature | Single-User | Multi-User |
|---------|-------------|------------|
| **Setup Time** | 10 min | 20 min + DNS |
| **Max Users** | 1 | Unlimited |
| **User Isolation** | ❌ No | ✅ Yes |
| **Auto-Provisioning** | ❌ No | ✅ Yes (API) |
| **Per-User Workspaces** | ❌ No | ✅ Yes (EFS AP) |
| **Subdomain Routing** | ❌ No | ✅ Yes |
| **Auto-Cleanup** | ❌ No | ✅ Yes (8h idle) |
| **Cost (1 user, 24/7)** | $118 | $153 |
| **Cost (10 users, 24/7)** | N/A | $726 |
| **Cost (10 users, auto-stop)** | N/A | $201 |
| **DNS Required** | No | Yes (wildcard) |
| **API Access** | No | Yes (REST) |
| **User Portal** | No | Yes (HTML) |
| **Monitoring** | Basic | Advanced |

## Quick Start Commands

### Single-User (Simple)
```bash
npm install
npm run build
npx cdk deploy

# Set API key
aws secretsmanager update-secret \
  --secret-id dev-claude-api-key \
  --secret-string '{"apiKey":"sk-ant-YOUR_KEY"}'

# Access
# Open URL from outputs, enter password
```

### Multi-User (Team)
```bash
npm install
npm run build

# Install Lambda dependencies
cd lambda/provisioning && npm install && cd ../..
cd lambda/cleanup && npm install && cd ../..

# Deploy
npx cdk deploy -c multiUser=true

# Set API key
aws secretsmanager update-secret \
  --secret-id dev-claude-shared-api-key \
  --secret-string '{"apiKey":"sk-ant-YOUR_KEY"}'

# Set up DNS: *.example.com → ALB DNS

# Request environment (for user "alice")
curl -X POST $API_ENDPOINT/dev/environments \
  -H "Content-Type: application/json" \
  -d '{"userId": "alice", "email": "alice@example.com"}'

# Access
# Open https://alice.example.com, enter password
```

## Migration Path

Start with single-user, migrate to multi-user later:

```bash
# 1. Deploy single-user first
npx cdk deploy

# Use it, test it, validate it works

# 2. Later, migrate to multi-user
npx cdk destroy  # Remove single-user stack

# 3. Deploy multi-user
cd lambda/provisioning && npm install && cd ../..
cd lambda/cleanup && npm install && cd ../..
npx cdk deploy -c multiUser=true
```

**Note:** Data migration not automatic. Backup your EFS data before switching.

## Recommendation

### Start Here ⭐
**If you're new:** Deploy **Single-User** first
- Learn the system
- Validate it works for you
- Understand costs
- Then upgrade to Multi-User if needed

### Go Here 🚀
**If you need multi-user now:** Deploy **Multi-User** directly
- You have a team
- Need user isolation
- Have DNS access
- Want auto-provisioning

## Support

Having trouble deciding?

**Choose Single-User if:**
- "I just want to try Claude Code"
- "I'm the only developer"
- "I want the simplest setup"
- "I don't have DNS access"

**Choose Multi-User if:**
- "I have a development team"
- "We need isolated environments"
- "I want to automate provisioning"
- "I can set up wildcard DNS"

## Next Steps

1. Choose your stack
2. Follow the appropriate deployment guide
3. Test with 1-2 users first
4. Scale as needed
5. Monitor costs

Both options work great! Pick what fits your needs. 🎉
