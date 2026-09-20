# Shared helpers for the slack-agent scripts. Source, do not execute.
# shellcheck shell=bash

STACK=${STACK:-SlackAgent1Stack}
REGION=${REGION:-${AWS_REGION:-ap-northeast-1}}

if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else G=""; R=""; Y=""; B=""; N=""; fi

die() { printf '%serror:%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

# Populates STACK_OUTPUTS, INSTANCE, TOPIC, QUEUE, TABLE, BUCKET, LOG_GROUP.
load_stack() {
  STACK_OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query 'Stacks[0].Outputs' --output json 2>/dev/null) \
    || die "stack $STACK not found in $REGION -- deploy it first with: npx cdk deploy"
  out() { echo "$STACK_OUTPUTS" | jq -r --arg k "$1" '.[]|select(.OutputKey==$k)|.OutputValue'; }
  TOPIC=$(out AlertTopicArn); QUEUE=$(out JobsQueueUrl); TABLE=$(out SessionsTable)
  BUCKET=$(out ArtifactsBucket); LOG_GROUP=$(out LogGroup)
  INSTANCE=$(out ShellCommand | awk '{print $NF}')
  [ -n "$INSTANCE" ] || die "could not determine the instance id from stack outputs"
}

# Run a bash script (on stdin) on the host via SSM; echo its stdout.
# No SSH and no inbound port -- SSM is the only way in.
#
# Returns the remote exit status. A failing step prints its stderr, because a
# silent empty result is the worst possible way to learn a deploy did not land.
remote() {
  local b64 cmd invocation timeout=${REMOTE_TIMEOUT:-900}
  b64=$(base64 | tr -d '\n')
  cmd=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
        --document-name AWS-RunShellScript --timeout-seconds "$timeout" \
        --parameters "executionTimeout=1800,commands=[\"echo $b64 | base64 -d > /tmp/agent-step.sh\",\"bash /tmp/agent-step.sh 2>&1\"]" \
        --query Command.CommandId --output text 2>/dev/null) || return 1
  aws ssm wait command-executed --region "$REGION" --command-id "$cmd" --instance-id "$INSTANCE" >/dev/null 2>&1
  local result
  result=$(aws ssm get-command-invocation --region "$REGION" --command-id "$cmd" \
    --instance-id "$INSTANCE" --output json 2>/dev/null) || return 1
  invocation=$(echo "$result" | jq -r '.Status')
  echo "$result" | jq -r '.StandardOutputContent'
  if [ "$invocation" != Success ]; then
    echo "$result" | jq -r '.StandardErrorContent' | sed 's/^/    ssm: /' >&2
    return 1
  fi
}

# Block until the host has finished its first boot. CloudFormation reports
# CREATE_COMPLETE minutes before cloud-init has installed Docker and built the
# worker image, and anything that runs in between fails confusingly.
wait_for_bootstrap() {
  local ping
  printf '    waiting for SSM' >&2
  for _ in $(seq 1 60); do
    ping=$(aws ssm describe-instance-information --region "$REGION" \
      --filters "Key=InstanceIds,Values=$INSTANCE" \
      --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)
    [ "$ping" = Online ] && break
    printf '.' >&2; sleep 5
  done
  printf '\n    waiting for cloud-init\n' >&2
  remote <<'EOS' >/dev/null
cloud-init status --wait >/dev/null 2>&1
[ "$(cloud-init status | awk '{print $2}')" = done ] || exit 1
[ -x /usr/local/bin/slack-agent-run-job ] || exit 1
EOS
}

require_app() {
  local present
  present=$(remote <<'EOS'
[ -f /opt/slack-agent/app/dist/ask.js ] && echo yes || echo no
EOS
)
  case "$present" in
    *yes*) : ;;
    *) die "the gateway app is not on the host yet -- run ./scripts/deploy-app.sh first" ;;
  esac
}
