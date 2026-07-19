# Simplest Ollama on AWS EC2 — System Design

> Goal: run Ollama + a model on a single EC2 instance, as simple as possible.
> No DB, no message queue, no load balancer. SSH in with a downloaded key.
> Server is fully open to the internet.

## 1. Architecture Components

| Component | Purpose | Simplest Choice |
|-----------|---------|-----------------|
| **EC2 instance** | Runs Ollama + the model | `g5.xlarge` (GPU, ~24GB) or `t3.xlarge` (CPU-only, cheap, slow) |
| **Key Pair** | SSH access — you download the `.pem` | Create one, download the private key |
| **Security Group** | Firewall — "full open" | Inbound `22` (SSH) + `11434` (Ollama API), open to `0.0.0.0/0` |
| **User Data script** | Auto-installs Ollama + pulls model on first boot | Bash script (below) |
| **EBS volume** | Stores OS + model weights | 50–100 GB gp3 (models are multi-GB) |
| **Elastic IP** *(optional)* | Stable public IP | Only if you want the IP to survive restarts |

No custom VPC — just the **default VPC**.

## 2. Diagram / Flow

```
                         ┌──────────────────────────────────────┐
   You (laptop)          │            AWS (default VPC)          │
   ┌──────────┐          │                                       │
   │  SSH      │  :22     │   ┌───────────────────────────────┐  │
   │  client   │─────────────▶│        EC2 Instance           │  │
   └──────────┘  .pem key │   │   (g5.xlarge / t3.xlarge)     │  │
   ┌──────────┐          │   │                               │  │
   │ curl /    │  :11434  │   │   ┌───────────────────────┐   │  │
   │ browser / │─────────────▶│   │  Ollama daemon        │   │  │
   │ app       │  HTTP    │   │   │  (ollama serve)       │   │  │
   └──────────┘          │   │   │   + model (llama3.2)  │   │  │
                          │   │   └───────────────────────┘   │  │
                          │   │        ▲                      │  │
                          │   │        │ user-data at boot    │  │
                          │   │   ┌─────┴──────┐              │  │
                          │   │   │ EBS 50GB   │ model weights│  │
                          │   │   └────────────┘              │  │
                          │   └───────────────────────────────┘  │
                          │        ▲ Security Group               │
                          │        │ inbound 22 + 11434 (0.0.0.0/0)│
                          └────────┼──────────────────────────────┘
                                   │
                            Public IP / EIP
```

**Boot sequence:**
1. EC2 launches → runs **user-data** script once.
2. Script installs Ollama, starts `ollama serve`, and `ollama pull`s the model.
3. You **SSH in** with the `.pem` key to check/manage it.
4. Anyone can hit the **API on `:11434`** over the internet.

## 3. User Data Script

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

# Pull a small model (adjust as needed)
sleep 5
ollama pull llama3.2
```

## 4. How You Use It

```bash
# SSH in to manage
ssh -i my-key.pem ubuntu@<PUBLIC_IP>

# Or hit the API from anywhere
curl http://<PUBLIC_IP>:11434/api/generate -d '{
  "model": "llama3.2",
  "prompt": "Why is the sky blue?",
  "stream": false
}'
```

## 5. Key Decisions

- **GPU vs CPU:** `g5.xlarge` (~$1/hr) runs 7B–8B models fast. `t3.xlarge` is cheap but slow — fine for tiny models like `llama3.2:1b`.
- **AMI:** Ubuntu 22.04 (Ollama install script just works). For GPU, use the **Deep Learning AMI** so NVIDIA drivers are pre-installed.
- **Model size ≤ RAM/VRAM:** pick a model that fits (e.g., `llama3.2` 3B, `phi3`, `qwen2.5:3b`).

## 6. Caveats

⚠️ **"Full open to internet"** means the Ollama API on `:11434` has **no auth** — anyone who finds the IP can use your GPU and run prompts on your bill.

For a playground that's fine, but:
- **Stop the instance when idle** (GPU costs add up fast).
- "Open" = "public and unauthenticated." Don't put anything sensitive on it.
- If you later want to lock it down: restrict the Security Group source to your own IP, or put a reverse proxy with an API key in front.
