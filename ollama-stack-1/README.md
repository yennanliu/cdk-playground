# ollama-stack-1

Simplest possible Ollama-on-EC2 stack. A single small CPU instance in the default
VPC, fully open to the internet, running a tiny model. No DB, no queue, no LB.

See [`doc/ollama-ec2-system-design.md`](doc/ollama-ec2-system-design.md) for the design.

## What it deploys

- **EC2** `t3.medium` (CPU-only) in the default VPC, public subnet + public IP
- **One disk**: default root volume, 20 GB gp3 (no separate EBS data volume)
- **Security group** open to `0.0.0.0/0` on `22` (SSH) and `11434` (Ollama API)
- **Key pair** `ollama-stack-1-key` (private key stored in SSM)
- **User data** installs Ollama, binds it to `0.0.0.0:11434`, and pulls `llama3.2:1b`

## Deploy

```bash
npm install
npm run build
npx cdk deploy
```

The stack outputs the public IP and ready-to-run commands.

## Use it

1. **Download the SSH key** (from the `DownloadKeyCommand` output):
   ```bash
   aws ssm get-parameter --name /ec2/keypair/<key-pair-id> \
     --with-decryption --query Parameter.Value --output text > ollama-stack-1-key.pem
   chmod 400 ollama-stack-1-key.pem
   ```
2. **SSH in** (from the `SshCommand` output):
   ```bash
   ssh -i ollama-stack-1-key.pem ubuntu@<PUBLIC_IP>
   ```
3. **Call the API** (from the `TestApiCommand` output — wait ~2-3 min after deploy for boot + model pull):
   ```bash
   curl http://<PUBLIC_IP>:11434/api/generate -d \
     '{"model":"llama3.2:1b","prompt":"Why is the sky blue?","stream":false}'
   ```

## Customize

Edit `lib/ollama-stack-1-stack.ts`:
- `instanceType` — bump to `t3.large` for bigger models
- `model` — e.g. `qwen2.5:0.5b` (smaller) or `llama3.2:3b` (bigger)

## ⚠️ Caveat

The Ollama API is **public and unauthenticated**. Anyone with the IP can use it.
Stop the instance when idle, and don't put anything sensitive on it.

## Commands

* `npm run build`   compile typescript
* `npm test`        run jest tests
* `npx cdk synth`   emit the CloudFormation template
* `npx cdk deploy`  deploy the stack
* `npx cdk destroy` tear it down
