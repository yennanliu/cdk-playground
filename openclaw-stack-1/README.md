# OpenClaw Stack — EC2 Deployment

CDK stack that deploys [OpenClaw](https://github.com/openclaw/openclaw) (open-source autonomous AI agent) on AWS EC2.

## Architecture

```
Internet
    │  (all ports open — IPv4 + IPv6)
    ▼
Elastic IP  ──────────────────────────────────────────────────────┐
    │                                                              │
    ▼                                                              │
Security Group (0.0.0.0/0 all traffic)                            │
    │                                                              │
    ▼                                                              │
EC2 t3.medium — Amazon Linux 2023          IAM Role               │
    ├── OpenClaw (systemd service)              ├── SSM Session Manager (shell access, no port 22)
    ├── Node.js 20 + Chromium                   └── CloudWatch Agent (logs)
    └── EBS 50 GB GP3 (persistent storage)                        │
                                                                   │
VPC (10.0.0.0/16) — 1 AZ, public subnet only, no NAT gateway      │
                                                                   │
Secrets Manager: openclaw/llm-api-key  ◄──────────────────────────┘
```

### Key design decisions

| Decision | Rationale |
|---|---|
| **EC2 over ECS/Lambda** | OpenClaw is a persistent daemon, not a request-handler. It needs a real filesystem for context/memory and a browser runtime (Chromium). EC2 is the most natural fit. |
| **Public subnet, no NAT gateway** | Instance has a public IP via Elastic IP — no NAT needed for outbound LLM API calls. Saves ~$45/mo. |
| **Elastic IP** | Gives a stable address across reboots and instance replacements without DNS changes. |
| **SSM Session Manager** | Shell access without opening port 22 or managing SSH keys day-to-day. Key pair is still provisioned for emergency/bootstrap access. |
| **systemd service** | OpenClaw starts on boot and auto-restarts on crash. |
| **Secrets Manager for API keys** | No secrets hardcoded in UserData, env files, or CDK code. IAM role grants the instance read access at runtime. |

---

## Prerequisites

```bash
npm install -g aws-cdk
aws configure          # ensure AWS credentials are set
cdk bootstrap          # once per account/region
```

## Deploy

```bash
npm install
npm run build
cdk deploy
```

The deploy takes ~5 minutes. Stack outputs printed at the end include everything you need.

## After deploy: download the key pair

```bash
# Copy the exact command from the DownloadKeyCommand stack output, e.g.:
aws ssm get-parameter \
  --name /ec2/keypair/<KeyPairId> \
  --with-decryption \
  --query Parameter.Value \
  --output text > openclaw-key.pem

chmod 400 openclaw-key.pem
```

## Connect to the instance

```bash
# Option A: SSH (use the SshCommand from stack outputs)
ssh -i openclaw-key.pem ec2-user@<ElasticIP>

# Option B: SSM Session Manager (no key needed)
aws ssm start-session --target <InstanceId>
```

## Configure and start OpenClaw

```bash
# 1. Set your LLM API key in Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id openclaw/llm-api-key \
  --secret-string '{"ANTHROPIC_API_KEY":"sk-ant-..."}'

# 2. SSH/SSM into the instance and populate /opt/openclaw/.env
#    (follow the OpenClaw docs for your messaging platform config)
sudo nano /opt/openclaw/.env

# 3. Start the agent
sudo systemctl start openclaw
sudo systemctl status openclaw

# 4. Tail logs
journalctl -u openclaw -f
```

## Useful commands

```bash
npm run build          # compile TypeScript
npm run clean          # remove compiled JS/d.ts artifacts
npm run clean:all      # also removes node_modules and cdk.out
cdk diff               # compare deployed stack vs local code
cdk deploy             # deploy / update
cdk destroy            # tear down all resources
```

## Cost estimate

| Resource | Monthly cost |
|---|---|
| t3.medium (on-demand) | ~$30 |
| EBS 50 GB GP3 | ~$4 |
| Elastic IP (attached) | $0 |
| Secrets Manager | ~$0.40 |
| NAT Gateway | $0 (none) |
| **Total** | **~$35/mo** |

Tip: switch to a Spot instance for ~70% savings — just add persistent EBS and a spot interruption handler.

## Further reading

- [OpenClaw deployment options survey](doc/openclaw-aws-deployment-options.md) — full comparison of EC2, ECS, EKS, Lambda, and App Runner approaches
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
