#!/usr/bin/env bash
#
# End-to-end test against a deployed SlackAgent1Stack.
#
#   ./scripts/e2e-test.sh                    # defaults below
#   STACK=SlackAgent1Stack REGION=ap-northeast-1 ./scripts/e2e-test.sh
#
# Exercises every path that exists today: the dispatch route into the host, the
# state stores, job isolation, the Bedrock call from inside a job container, and
# the credential separation that is supposed to make all of it safe.
#
# Read-only apart from three items it creates and deletes: one SNS message, one
# DynamoDB row, one S3 object. Host checks run through SSM, so no SSH and no
# inbound port is needed.
#
set -uo pipefail

STACK=${STACK:-SlackAgent1Stack}
REGION=${REGION:-${AWS_REGION:-ap-northeast-1}}
RUN_ID="e2e-$(date +%s)"

pass=0; fail=0; skip=0
if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else G=""; R=""; Y=""; B=""; N=""; fi

ok()      { printf '  %s✓%s %s\n' "$G" "$N" "$1"; pass=$((pass+1)); }
bad()     { printf '  %s✗%s %s\n' "$R" "$N" "$1"; [ $# -gt 1 ] && printf '      %s\n' "$2"; fail=$((fail+1)); }
skipped() { printf '  %s-%s %s\n' "$Y" "$N" "$1"; skip=$((skip+1)); }
section() { printf '\n%s%s%s\n' "$B" "$1" "$N"; }
# assert <condition-result> <description> [detail-on-failure]
assert()  { if [ "$1" = "true" ]; then ok "$2"; else bad "$2" "${3:-}"; fi; }

printf '%sE2E: %s in %s%s\n' "$B" "$STACK" "$REGION" "$N"

# ---------------------------------------------------------------------------
section "Stack"

status=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null)
if [ -z "$status" ]; then
  bad "stack $STACK not found in $REGION" "deploy it first: npx cdk deploy"
  exit 1
fi
case "$status" in
  CREATE_COMPLETE|UPDATE_COMPLETE) ok "stack status $status" ;;
  *) bad "stack status $status" "expected CREATE_COMPLETE or UPDATE_COMPLETE" ;;
esac

outputs=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].Outputs' --output json)
out() { echo "$outputs" | jq -r --arg k "$1" '.[]|select(.OutputKey==$k)|.OutputValue'; }

TOPIC=$(out AlertTopicArn)
QUEUE=$(out JobsQueueUrl)
TABLE=$(out SessionsTable)
BUCKET=$(out ArtifactsBucket)
LOG_GROUP=$(out LogGroup)
INSTANCE=$(out ShellCommand | awk '{print $NF}')

printf '  instance %s\n' "$INSTANCE"

# Run a script (on stdin) on the host via SSM and echo its stdout.
remote() {
  local b64 cmd
  b64=$(base64 | tr -d '\n')
  cmd=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
        --document-name AWS-RunShellScript --timeout-seconds 900 \
        --parameters "executionTimeout=1800,commands=[\"echo $b64 | base64 -d > /tmp/e2e-step.sh\",\"bash /tmp/e2e-step.sh 2>&1\"]" \
        --query Command.CommandId --output text 2>/dev/null) || return 1
  aws ssm wait command-executed --region "$REGION" --command-id "$cmd" --instance-id "$INSTANCE" >/dev/null 2>&1
  aws ssm get-command-invocation --region "$REGION" --command-id "$cmd" --instance-id "$INSTANCE" \
    --query StandardOutputContent --output text 2>/dev/null
}

# ---------------------------------------------------------------------------
section "Host"

state=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE" \
  --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null)
assert "$([ "$state" = running ] && echo true || echo false)" "instance is running" "state=$state"

ping=$(aws ssm describe-instance-information --region "$REGION" \
  --filters "Key=InstanceIds,Values=$INSTANCE" \
  --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)
assert "$([ "$ping" = Online ] && echo true || echo false)" "SSM agent online (shell without SSH)" "ping=$ping"

if [ "$ping" != Online ]; then
  bad "cannot reach the host over SSM; skipping host checks"
  exit 1
fi

# The bootstrap keeps running for minutes after CloudFormation says COMPLETE.
host=$(remote <<'EOS'
cloud-init status --wait >/dev/null 2>&1
source /etc/slack-agent/agent.env
echo "cloudinit=$(cloud-init status | awk '{print $2}')"
echo "docker=$(systemctl is-active docker)"
echo "cwagent=$(systemctl is-active amazon-cloudwatch-agent)"
echo "image=$(docker images -q "$AGENT_WORKER_IMAGE" | head -1 | grep -q . && echo yes || echo no)"
echo "imdsrule=$(iptables -S DOCKER-USER | grep -c '169.254.169.254')"
echo "runner=$([ -x /usr/local/bin/slack-agent-run-job ] && echo yes || echo no)"
echo "gateway=$(systemctl is-enabled slack-agent-gateway 2>/dev/null || echo absent)"
echo "model=$AGENT_BEDROCK_MODEL_ID"
EOS
)
val() { echo "$host" | tr -d '\r' | grep "^$1=" | cut -d= -f2-; }

assert "$([ "$(val cloudinit)" = done ] && echo true || echo false)" "bootstrap finished" "cloud-init=$(val cloudinit)"
assert "$([ "$(val docker)" = active ] && echo true || echo false)" "docker running"
assert "$([ "$(val image)" = yes ] && echo true || echo false)" "worker image built on the host"
assert "$([ "$(val runner)" = yes ] && echo true || echo false)" "slack-agent-run-job installed"
assert "$([ "$(val cwagent)" = active ] && echo true || echo false)" "CloudWatch agent running"
assert "$([ "$(val imdsrule)" != 0 ] && echo true || echo false)" "DOCKER-USER rule blocks IMDS"
# Installed-but-disabled is the intended Phase 0 state: there is no app yet.
assert "$([ "$(val gateway)" = disabled ] && echo true || echo false)" \
  "gateway unit installed, not enabled (no app deployed yet)" "state=$(val gateway)"

MODEL=$(val model)
printf '  model %s\n' "$MODEL"

# ---------------------------------------------------------------------------
section "Dispatch — alarms and schedules reach the host's queue"

aws sns publish --region "$REGION" --topic-arn "$TOPIC" \
  --message "{\"source\":\"e2e\",\"id\":\"$RUN_ID\"}" >/dev/null 2>&1
assert "$([ $? -eq 0 ] && echo true || echo false)" "published to the alert topic"

found=false; receipt=""
for _ in 1 2 3 4 5 6; do
  msgs=$(aws sqs receive-message --region "$REGION" --queue-url "$QUEUE" \
    --max-number-of-messages 10 --wait-time-seconds 5 --output json 2>/dev/null)
  if echo "$msgs" | grep -q "$RUN_ID"; then
    found=true
    receipt=$(echo "$msgs" | jq -r --arg id "$RUN_ID" \
      '.Messages[]|select(.Body|contains($id))|.ReceiptHandle' | head -1)
    break
  fi
done
assert "$found" "SNS message arrived on the jobs queue (raw delivery)"
[ -n "$receipt" ] && aws sqs delete-message --region "$REGION" --queue-url "$QUEUE" \
  --receipt-handle "$receipt" >/dev/null 2>&1 && ok "test message removed from the queue"

# Derive the DLQ from the redrive policy rather than guessing its name -- CDK
# gives each queue its own hash suffix.
redrive=$(aws sqs get-queue-attributes --region "$REGION" --queue-url "$QUEUE" \
  --attribute-names RedrivePolicy --query 'Attributes.RedrivePolicy' --output text 2>/dev/null)
dlq_name=$(echo "$redrive" | jq -r '.deadLetterTargetArn // empty' 2>/dev/null | awk -F: '{print $NF}')
dlq=""
[ -n "$dlq_name" ] && dlq=$(aws sqs get-queue-url --region "$REGION" --queue-name "$dlq_name" \
  --query QueueUrl --output text 2>/dev/null)
if [ -n "$dlq" ] && [ "$dlq" != None ]; then
  depth=$(aws sqs get-queue-attributes --region "$REGION" --queue-url "$dlq" \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' --output text 2>/dev/null)
  assert "$([ "${depth:-0}" = 0 ] && echo true || echo false)" "dead-letter queue is empty" "depth=$depth"
else
  skipped "dead-letter queue lookup"
fi

# ---------------------------------------------------------------------------
section "State — session store and artifact bucket"

aws dynamodb put-item --region "$REGION" --table-name "$TABLE" \
  --item "{\"pk\":{\"S\":\"$RUN_ID\"},\"ttl\":{\"N\":\"$(( $(date +%s) + 300 ))\"}}" >/dev/null 2>&1
got=$(aws dynamodb get-item --region "$REGION" --table-name "$TABLE" \
  --key "{\"pk\":{\"S\":\"$RUN_ID\"}}" --query 'Item.pk.S' --output text 2>/dev/null)
assert "$([ "$got" = "$RUN_ID" ] && echo true || echo false)" "sessions table accepts a thread-keyed row"
aws dynamodb delete-item --region "$REGION" --table-name "$TABLE" \
  --key "{\"pk\":{\"S\":\"$RUN_ID\"}}" >/dev/null 2>&1

ttl=$(aws dynamodb describe-time-to-live --region "$REGION" --table-name "$TABLE" \
  --query 'TimeToLiveDescription.TimeToLiveStatus' --output text 2>/dev/null)
assert "$([ "$ttl" = ENABLED ] && echo true || echo false)" "session TTL enabled (memory stays bounded)" "status=$ttl"

echo "$RUN_ID" | aws s3 cp - "s3://$BUCKET/e2e/$RUN_ID.txt" >/dev/null 2>&1
assert "$(aws s3 ls "s3://$BUCKET/e2e/$RUN_ID.txt" >/dev/null 2>&1 && echo true || echo false)" \
  "artifacts bucket accepts an object"
aws s3 rm "s3://$BUCKET/e2e/$RUN_ID.txt" >/dev/null 2>&1

# ---------------------------------------------------------------------------
section "Job isolation — the security model, tested on a real job"

job=$(remote <<EOS
source /etc/slack-agent/agent.env
slack-agent-run-job $RUN_ID bash -c '
  curl -s --max-time 4 http://169.254.169.254/latest/meta-data/ >/dev/null 2>&1 \
    && echo "imds=reachable" || echo "imds=blocked"
  echo "uid=\$(id -u)"
  touch /probe 2>/dev/null && echo "rootfs=writable" || echo "rootfs=readonly"
  touch /workspace/probe 2>/dev/null && echo "workspace=writable" || echo "workspace=readonly"
  [ -n "\$AWS_SESSION_TOKEN" ] && echo "creds=scoped" || echo "creds=missing"
'
echo "exit=\$?"
echo "leftover=\$(ls -A /var/lib/slack-agent/jobs/ 2>/dev/null | wc -l)"
EOS
)
jval() { echo "$job" | tr -d '\r' | grep "^$1=" | cut -d= -f2-; }

assert "$([ "$(jval exit)" = 0 ] && echo true || echo false)" "job ran to completion"
assert "$([ "$(jval imds)" = blocked ] && echo true || echo false)" \
  "job container CANNOT reach IMDS (cannot steal the instance role)"
assert "$([ "$(jval uid)" = 1000 ] && echo true || echo false)" "job runs as non-root uid 1000"
assert "$([ "$(jval rootfs)" = readonly ] && echo true || echo false)" "job root filesystem is read-only"
assert "$([ "$(jval workspace)" = writable ] && echo true || echo false)" "job workspace is writable"
assert "$([ "$(jval creds)" = scoped ] && echo true || echo false)" "job received scoped credentials"
assert "$([ "$(jval leftover)" = 0 ] && echo true || echo false)" \
  "workspace removed after the job" "leftover dirs=$(jval leftover)"

# ---------------------------------------------------------------------------
section "Least privilege — what the job role must NOT be able to do"

deny=$(remote <<'EOS'
source /etc/slack-agent/agent.env
creds=$(aws sts assume-role --role-arn "$AGENT_JOB_ROLE_ARN" --role-session-name e2e \
  --duration-seconds 900 --query Credentials --output json 2>/dev/null)
export AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r .AccessKeyId)
export AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r .SecretAccessKey)
export AWS_SESSION_TOKEN=$(echo "$creds" | jq -r .SessionToken)
aws secretsmanager get-secret-value --secret-id "$AGENT_SECRET_ARN" >/dev/null 2>&1 \
  && echo "secret=READABLE" || echo "secret=denied"
aws dynamodb scan --table-name "$AGENT_SESSIONS_TABLE" --max-items 1 >/dev/null 2>&1 \
  && echo "table=READABLE" || echo "table=denied"
aws s3 ls "s3://$AGENT_ARTIFACTS_BUCKET/" >/dev/null 2>&1 \
  && echo "bucket=READABLE" || echo "bucket=denied"
EOS
)
dval() { echo "$deny" | tr -d '\r' | grep "^$1=" | cut -d= -f2-; }

assert "$([ "$(dval secret)" = denied ] && echo true || echo false)" \
  "job role DENIED on the Slack/GitHub secret" "got $(dval secret)"
assert "$([ "$(dval table)" = denied ] && echo true || echo false)" \
  "job role DENIED on the sessions table" "got $(dval table)"
assert "$([ "$(dval bucket)" = denied ] && echo true || echo false)" \
  "job role DENIED on the artifacts bucket" "got $(dval bucket)"

# ---------------------------------------------------------------------------
section "Bedrock — a job container reaching the model"

bedrock=$(remote <<'EOS'
source /etc/slack-agent/agent.env
slack-agent-run-job bedrock bash -c '
cd /workspace
npm install --silent --no-fund --no-audit @aws-sdk/client-bedrock-runtime >/dev/null 2>&1 \
  || { echo "result=npm-failed"; exit 1; }
node -e "
const {BedrockRuntimeClient,InvokeModelCommand}=require(\"/workspace/node_modules/@aws-sdk/client-bedrock-runtime\");
new BedrockRuntimeClient({region:process.env.AWS_REGION}).send(new InvokeModelCommand({
  modelId:process.env.AGENT_BEDROCK_MODEL_ID, contentType:\"application/json\",
  body:JSON.stringify({anthropic_version:\"bedrock-2023-05-31\",max_tokens:32,
    messages:[{role:\"user\",content:\"Reply with exactly: E2E_OK\"}]})}))
 .then(r=>{const b=JSON.parse(Buffer.from(r.body).toString());
   console.log(\"result=\"+b.content.filter(x=>x.type===\"text\").map(x=>x.text).join(\"\").trim());
   console.log(\"tokens=\"+b.usage.input_tokens+\"/\"+b.usage.output_tokens);})
 .catch(e=>console.log(\"result=\"+e.name));
"
'
EOS
)
result=$(echo "$bedrock" | tr -d '\r' | grep '^result=' | cut -d= -f2-)
tokens=$(echo "$bedrock" | tr -d '\r' | grep '^tokens=' | cut -d= -f2-)

if [ "$result" = "E2E_OK" ]; then
  ok "job container invoked $MODEL (${tokens:-?} tokens in/out)"
elif [ "$result" = "AccessDeniedException" ]; then
  bad "job container denied by Bedrock" \
    "Enable model access for $MODEL under Bedrock > Model access. This is an account setting, not this stack's IAM."
else
  bad "job container could not invoke $MODEL" "got: ${result:-no response}"
fi

# ---------------------------------------------------------------------------
section "Observability"

streams=$(aws logs describe-log-streams --region "$REGION" --log-group-name "$LOG_GROUP" \
  --query 'length(logStreams)' --output text 2>/dev/null)
assert "$([ "${streams:-0}" -gt 0 ] 2>/dev/null && echo true || echo false)" \
  "log group $LOG_GROUP is receiving streams" "streams=${streams:-0}"

# ---------------------------------------------------------------------------
printf '\n%s%d passed, %d failed, %d skipped%s\n' "$B" "$pass" "$fail" "$skip" "$N"
[ "$fail" -eq 0 ] || exit 1
