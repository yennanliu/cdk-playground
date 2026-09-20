#!/usr/bin/env bash
#
# Build the gateway app and install it on the host.
#
#   ./scripts/deploy-app.sh            # build, upload, install, restart
#   ./scripts/deploy-app.sh --no-start # install but leave the service stopped
#
# Ships through the artifacts bucket rather than an S3 asset in CDK, so shipping
# a new version of the application does not replace the instance. Infrastructure
# changes still go through `cdk deploy`; this is the app-only path.
#
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

START=true
[ "${1:-}" = "--no-start" ] && START=false

load_stack
printf '%sDeploying gateway app to %s%s\n' "$B" "$INSTANCE" "$N"

echo "==> building"
( cd agent && npm install --silent --no-fund --no-audit && npm run build --silent )

echo "==> packaging"
TARBALL=$(mktemp -t slack-agent-app-XXXXXX).tgz
tar -czf "$TARBALL" -C agent dist package.json package-lock.json
KEY="app/gateway-$(date +%Y%m%d-%H%M%S).tgz"
SIZE=$(du -h "$TARBALL" | cut -f1)
aws s3 cp "$TARBALL" "s3://$BUCKET/$KEY" --region "$REGION" >/dev/null
rm -f "$TARBALL"
printf '    s3://%s/%s (%s)\n' "$BUCKET" "$KEY" "$SIZE"

echo "==> waiting for host bootstrap"
wait_for_bootstrap || die "host bootstrap has not finished -- check: ./scripts/logs.sh"

echo "==> installing on host"
REMOTE_TIMEOUT=900 remote <<EOS
set -euxo pipefail
install -d -o slackagent -g slackagent /opt/slack-agent/app
aws s3 cp "s3://$BUCKET/$KEY" /tmp/gateway.tgz --region "$REGION"
tar -xzf /tmp/gateway.tgz -C /opt/slack-agent/app
rm -f /tmp/gateway.tgz
cd /opt/slack-agent/app
npm install --omit=dev --no-fund --no-audit --silent
chown -R slackagent:slackagent /opt/slack-agent/app
EOS

if [ "$START" = true ]; then
  echo "==> starting service"
  remote <<'EOS'
set -x
systemctl daemon-reload
systemctl enable --now slack-agent-gateway
sleep 5
systemctl is-active slack-agent-gateway
journalctl -u slack-agent-gateway -n 20 --no-pager
EOS
else
  echo "==> leaving service stopped (--no-start)"
fi

printf '\n%sDone.%s Send a request with:  ./scripts/send-request.sh "hello"\n' "$G" "$N"
