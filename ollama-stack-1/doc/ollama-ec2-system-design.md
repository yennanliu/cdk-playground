# Simplest Ollama on AWS EC2 — System Design

> Goal: run Ollama + a tiny model on a single, small CPU EC2 instance, as simple as possible.
> No DB, no message queue, no load balancer, no separate data disk.
> SSH in with a downloaded key. Server is fully open to the internet.

## 1. Architecture Components

| Component | Purpose | Simplest Choice |
|-----------|---------|-----------------|
| **EC2 instance** | Runs Ollama + a tiny model | `t3.medium` (2 vCPU / 4 GB, CPU-only, ~$0.04/hr) |
| **Key Pair** | SSH access — you download the `.pem` | Create one, download the private key |
| **Security Group** | Firewall — "full open" | Inbound `22` (SSH) + `11434` (Ollama API), open to `0.0.0.0/0` |
| **User Data script** | Auto-installs Ollama + pulls model on first boot | Bash script (below) |
| **Root disk (default)** | OS + model weights — the *only* disk | Default root volume bumped to ~20 GB gp3 |

No custom VPC — just the **default VPC**. No separate EBS data volume.

### On "no EBS"

Every EC2 needs a *root volume* to boot, and for normal instance types that root volume **is EBS** — there's no zero-disk EC2. So instead of adding a *separate* 50 GB data volume, we just use the **default root volume** (bumped to ~20 GB). One disk, nothing extra to manage. Tiny models are only ~0.4–1.3 GB, so this is plenty.

*(Truly EBS-less "instance store" exists on a few instance types, but it wipes on every stop — Ollama would re-download the model each boot. More complexity, not less. Skip it.)*

## 2. Diagram / Flow

```
                         ┌──────────────────────────────────────┐
   You (laptop)          │            AWS (default VPC)          │
   ┌──────────┐          │                                       │
   │  SSH      │  :22     │   ┌───────────────────────────────┐  │
   │  client   │─────────────▶│        EC2 Instance           │  │
   └──────────┘  .pem key │   │      t3.medium (CPU)          │  │
   ┌──────────┐          │   │                               │  │
   │ curl /    │  :11434  │   │   ┌───────────────────────┐   │  │
   │ browser / │─────────────▶│   │  Ollama daemon        │   │  │
   │ app       │  HTTP    │   │   │  (ollama serve)       │   │  │
   └──────────┘          │   │   │   + llama3.2:1b       │   │  │
                          │   │   └───────────────────────┘   │  │
                          │   │        ▲                      │  │
                          │   │        │ user-data at boot    │  │
                          │   │   ┌─────┴──────┐              │  │
                          │   │   │ root disk  │ ~20GB (model)│  │
                          │   │   │ (default)  │              │  │
                          │   │   └────────────┘              │  │
                          │   └───────────────────────────────┘  │
                          │        ▲ Security Group               │
                          │        │ inbound 22 + 11434 (0.0.0.0/0)│
                          └────────┼──────────────────────────────┘
                                   │
                            Public IP
```

**Boot sequence:**
1. EC2 launches → runs **user-data** script once.
2. Script installs Ollama, starts `ollama serve`, and `ollama pull`s the tiny model.
3. You **SSH in** with the `.pem` key to check/manage it.
4. Anyone can hit the **API on `:11434`** over the internet.

## 3. Instance & Model Sizing

Rule of thumb: **RAM ≥ 2× model size**. All CPU-only — no GPU needed for tiny models.

| Instance | vCPU / RAM | ~Cost | Runs |
|----------|-----------|-------|------|
| `t3.small` | 2 / 2 GB | ~$0.02/hr | `qwen2.5:0.5b`, `tinyllama` (tight) |
| **`t3.medium`** ⭐ | 2 / 4 GB | ~$0.04/hr | `llama3.2:1b`, `qwen2.5:0.5b` — **sweet spot** |
| `t3.large` | 2 / 8 GB | ~$0.08/hr | `llama3.2:1b` / `3b` comfortably |

**Smallest models:**
- `qwen2.5:0.5b` — ~400 MB, tiniest real model
- `tinyllama` — ~640 MB
- `llama3.2:1b` — ~1.3 GB, still small, noticeably better quality ⭐

**Recommendation:** `t3.medium` + `llama3.2:1b`.

## 4. User Data Script

```bash
#!/bin/bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Make it listen on all interfaces (not just localhost) so it's reachable from internet
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF

systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama

# Pull the tiny model (adjust as needed)
sleep 5
ollama pull llama3.2:1b
```

## 5. How You Use It

```bash
# SSH in to manage
ssh -i my-key.pem ubuntu@<PUBLIC_IP>

# Or hit the API from anywhere
curl http://<PUBLIC_IP>:11434/api/generate -d '{
  "model": "llama3.2:1b",
  "prompt": "Why is the sky blue?",
  "stream": false
}'
```

## 6. Key Decisions

- **CPU is fine** for tiny models — no GPU, no Deep Learning AMI, no NVIDIA drivers.
- **AMI:** Ubuntu 22.04 (the Ollama install script just works).
- **One disk only:** default root volume ~20 GB. No separate EBS data volume.
- **Model size ≤ RAM/2:** pick a model that fits (e.g., `llama3.2:1b` on 4 GB RAM).

## 7. Caveats

⚠️ **"Full open to internet"** means the Ollama API on `:11434` has **no auth** — anyone who finds the IP can run prompts on your instance.

For a playground that's fine, but:
- **Stop the instance when idle** (t3.medium is cheap, but why pay for nothing).
- "Open" = "public and unauthenticated." Don't put anything sensitive on it.
- If you later want to lock it down: restrict the Security Group source to your own IP, or put a reverse proxy with an API key in front.
- CPU inference is **slow** — expect a few tokens/sec on `t3.medium`. Fine for smoke tests, not for real workloads.
