#!/usr/bin/env bash
#
# Phase 0 host bootstrap. Runs once from EC2 user data, on Amazon Linux 2023.
#
# Leaves behind:
#   /etc/slack-agent/agent.env        config, written by user data before this runs
#   /usr/local/bin/slack-agent-run-job  the only sanctioned way to execute a job
#   slack-agent-worker:local          the job image, built from the shipped context
#   slack-agent-gateway.service       installed, NOT started -- see the end of this file
#
set -euxo pipefail

source /etc/slack-agent/agent.env

# --- packages ----------------------------------------------------------------
dnf install -y docker git jq unzip iptables-nft iptables-services amazon-cloudwatch-agent
# Node runs the gateway. AL2023 carries several majors; prefer the newest.
dnf install -y nodejs22 || dnf install -y nodejs

systemctl enable --now docker

# --- keep containers away from IMDS ------------------------------------------
# A job container that can reach 169.254.169.254 can mint credentials for the
# *instance* role, which would make the job role pointless. DOCKER-USER is the
# chain Docker leaves alone for exactly this kind of rule.
iptables -I DOCKER-USER -d 169.254.169.254 -j REJECT
iptables-save > /etc/sysconfig/iptables
systemctl enable iptables

# --- job image ---------------------------------------------------------------
install -d /opt/slack-agent/worker
unzip -o /opt/slack-agent/worker.zip -d /opt/slack-agent/worker
docker build -t "$AGENT_WORKER_IMAGE" /opt/slack-agent/worker

# --- job runner --------------------------------------------------------------
cat > /usr/local/bin/slack-agent-run-job <<'RUNNER'
#!/usr/bin/env bash
#
# Run one agent job in a throwaway container:
#
#   slack-agent-run-job <job-id> [command...]
#
# The job gets a scratch workspace, network access, and Bedrock-only
# credentials. It does not get the host filesystem, the instance role, IMDS,
# root, or more wall-clock time than AGENT_JOB_TIMEOUT_SECONDS.
set -euo pipefail

job_id="${1:?usage: slack-agent-run-job <job-id> [command...]}"
shift

# shellcheck source=/dev/null
source /etc/slack-agent/agent.env

workspace="$(mktemp -d "/var/lib/slack-agent/jobs/${job_id}.XXXXXXXX")"
chown 1000:1000 "$workspace"

container="slack-agent-job-${job_id}"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$workspace"
}
trap cleanup EXIT

# Short-lived credentials scoped to the job role. Duration is the role's
# maximum, independent of the job timeout, which is enforced below.
creds="$(aws sts assume-role \
  --role-arn "$AGENT_JOB_ROLE_ARN" \
  --role-session-name "job-${job_id}" \
  --duration-seconds 3600 \
  --query Credentials --output json)"

# GITHUB_TOKEN is passed through from the caller's environment if set -- the
# gateway mints a short-lived GitHub App installation token per job rather than
# keeping a long-lived one on disk.
timeout --signal=TERM --kill-after=30s "${AGENT_JOB_TIMEOUT_SECONDS}s" \
  docker run --rm \
    --name "$container" \
    --user 1000:1000 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 512 \
    --memory 2g \
    --cpus 2 \
    --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,size=1g \
    --mount "type=bind,src=${workspace},dst=/workspace" \
    -e HOME=/tmp \
    -e AWS_REGION="$AWS_REGION" \
    -e AWS_ACCESS_KEY_ID="$(jq -r .AccessKeyId <<<"$creds")" \
    -e AWS_SECRET_ACCESS_KEY="$(jq -r .SecretAccessKey <<<"$creds")" \
    -e AWS_SESSION_TOKEN="$(jq -r .SessionToken <<<"$creds")" \
    -e AGENT_BEDROCK_MODEL_ID="$AGENT_BEDROCK_MODEL_ID" \
    -e GITHUB_TOKEN \
    "$AGENT_WORKER_IMAGE" "$@"
RUNNER
chmod 0755 /usr/local/bin/slack-agent-run-job

# --- service account ---------------------------------------------------------
id -u slackagent >/dev/null 2>&1 \
  || useradd --system --create-home --home-dir /var/lib/slack-agent slackagent
install -d -o slackagent -g slackagent /var/lib/slack-agent/jobs /opt/slack-agent/app /var/log/slack-agent

# The gateway launches containers, so it needs the Docker socket -- which on
# this host is root-equivalent. It is the sharpest edge in Phase 0 and the main
# thing Phase 1 buys back: on Fargate the gateway only needs ecs:RunTask.
usermod -aG docker slackagent
chgrp slackagent /etc/slack-agent/agent.env

# --- observability -----------------------------------------------------------
cat > /opt/aws/amazon-cloudwatch-agent/etc/slack-agent.json <<CWAGENT
{
  "agent": { "run_as_user": "root" },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/cloud-init-output.log",
            "log_group_name": "$AGENT_LOG_GROUP",
            "log_stream_name": "{instance_id}/bootstrap"
          },
          {
            "file_path": "/var/log/slack-agent/*.log",
            "log_group_name": "$AGENT_LOG_GROUP",
            "log_stream_name": "{instance_id}/agent"
          }
        ]
      }
    }
  }
}
CWAGENT
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/slack-agent.json

# --- gateway service ---------------------------------------------------------
cat > /etc/systemd/system/slack-agent-gateway.service <<'UNIT'
[Unit]
Description=Slack agent gateway (Socket Mode)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=slackagent
EnvironmentFile=/etc/slack-agent/agent.env
WorkingDirectory=/opt/slack-agent/app
ExecStart=/usr/bin/node /opt/slack-agent/app/dist/gateway.js
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

# Deliberately installed but not enabled: there is no application at
# /opt/slack-agent/app yet, and a unit that crash-loops from first boot buries
# the bootstrap logs you would need to debug anything else. Deploy the gateway,
# then `systemctl enable --now slack-agent-gateway`.
