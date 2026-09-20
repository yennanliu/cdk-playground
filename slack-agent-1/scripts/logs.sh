#!/usr/bin/env bash
#
# Tail the gateway's logs.
#
#   ./scripts/logs.sh          # last 80 lines
#   ./scripts/logs.sh 200      # last 200 lines
#
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh
load_stack
LINES=${1:-80}
remote <<EOS
systemctl is-active slack-agent-gateway || true
journalctl -u slack-agent-gateway -n $LINES --no-pager
EOS
