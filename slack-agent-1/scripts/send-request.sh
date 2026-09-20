#!/usr/bin/env bash
#
# Send one request to the agent and print its answer.
#
#   ./scripts/send-request.sh "how many CPUs does the sandbox have?"
#   ./scripts/send-request.sh --alert '{"AlarmName":"HighCPU","NewStateValue":"ALARM"}'
#   ./scripts/send-request.sh -v "clone facebook/react and count the test files"
#
# Default mode goes straight to the model and its sandbox tool -- the same code
# path a Slack message takes, minus Slack. It works before any Slack app exists,
# which makes it the quickest way to see whether the agent is alive.
#
# --alert publishes to the SNS topic instead, exercising the other half: alarm
# to queue to gateway to Slack. That one needs the service running and a
# configured channel, and the answer appears in Slack rather than here.
#
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

MODE=ask
VERBOSE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --alert) MODE=alert; shift ;;
    -v|--verbose) VERBOSE=true; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) break ;;
  esac
done

[ $# -gt 0 ] || die "nothing to send -- usage: ./scripts/send-request.sh \"<your question>\""
PAYLOAD="$*"

load_stack

if [ "$MODE" = alert ]; then
  aws sns publish --region "$REGION" --topic-arn "$TOPIC" --message "$PAYLOAD" >/dev/null
  printf '%s->%s published to the alert topic\n' "$B" "$N"
  printf '   The gateway triages it and posts to the channel in `slackAlertChannel`.\n'
  printf '   Watch it land:  ./scripts/logs.sh\n'
  exit 0
fi

require_app
printf '%s->%s %s\n\n' "$B" "$N" "$PAYLOAD"

# The prompt is passed through base64 so quoting, newlines and backticks in the
# question cannot break out of the remote shell.
ENCODED=$(printf '%s' "$PAYLOAD" | base64 | tr -d '\n')
STDERR_TO=$([ "$VERBOSE" = true ] && echo "&1" || echo "/dev/null")

REMOTE_TIMEOUT=1800 remote <<EOS
set -o pipefail
cd /opt/slack-agent/app
set -a; source /etc/slack-agent/agent.env; set +a
sudo -u slackagent --preserve-env \
  node dist/ask.js "\$(echo $ENCODED | base64 -d)" 2>$STDERR_TO
EOS
