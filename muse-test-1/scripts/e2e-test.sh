#!/usr/bin/env bash
#
# Run the deployed-stack tests (app/tests/integration/test_deployed.py) through
# an SSM port-forwarding tunnel -- the same way you reach the UI.
#
#   scripts/e2e-test.sh            # needs the session-manager-plugin
#
set -euo pipefail
cd "$(dirname "$0")/.."

stack="${STACK:-MuseTest1Stack}"
port="${PORT:-18080}"

instance="$(aws cloudformation describe-stacks --stack-name "$stack" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)"

aws ssm start-session --target "$instance" --document-name AWS-StartPortForwardingSession \
  --parameters "portNumber=8080,localPortNumber=$port" >/dev/null &
tunnel=$!
trap 'kill "$tunnel" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  curl -fs "http://localhost:$port/health" >/dev/null && break
  sleep 1
done

cd app
MUSE_URL="http://localhost:$port" uv run pytest -m deployed -v
