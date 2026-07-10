#!/usr/bin/env bash
#
# Watch a CloudFormation stack deletion (e.g. started via `cdk destroy`) and
# optionally force it through if it gets stuck on DELETE_FAILED resources.
#
# Usage:
#   ./scripts/cdk-destroy-watch.sh <stack-name> [--interval SECONDS] [--stuck-after MINUTES] [--force]
#
# --interval SECONDS     Poll interval (default: 15)
# --stuck-after MINUTES  Warn if no new stack event appears for this long (default: 20)
# --force                If the stack ends up DELETE_FAILED, automatically retry
#                         `aws cloudformation delete-stack` with --retain-resources
#                         for whichever logical IDs failed, so the stack finishes
#                         deleting. The retained resources are NOT deleted - you
#                         must clean those up by hand afterward.
#
# Exit codes: 0 = stack fully deleted, 1 = DELETE_FAILED (and not resolved), 2 = usage error

set -euo pipefail

STACK_NAME="${1:-}"
shift || true

INTERVAL=15
STUCK_AFTER_MIN=20
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) INTERVAL="$2"; shift 2 ;;
    --stuck-after) STUCK_AFTER_MIN="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$STACK_NAME" ]]; then
  echo "Usage: $0 <stack-name> [--interval SECONDS] [--stuck-after MINUTES] [--force]" >&2
  exit 2
fi

STUCK_AFTER_SEC=$((STUCK_AFTER_MIN * 60))
seen_ids_file="$(mktemp)"
trap 'rm -f "$seen_ids_file"' EXIT
last_new_event_at=$(date +%s)

echo "Watching stack: $STACK_NAME (poll every ${INTERVAL}s, stuck warning after ${STUCK_AFTER_MIN}m)"

while true; do
  stack_json="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" 2>/dev/null || true)"

  if [[ -z "$stack_json" ]]; then
    echo "[$(date '+%H:%M:%S')] Stack '$STACK_NAME' no longer exists - deletion complete."
    exit 0
  fi

  status="$(echo "$stack_json" | jq -r '.Stacks[0].StackStatus')"

  events_json="$(aws cloudformation describe-stack-events --stack-name "$STACK_NAME" --max-items 50 2>/dev/null || echo '{"StackEvents":[]}')"

  new_events="$(echo "$events_json" | jq -c '.StackEvents[]' | tac)"
  if [[ -n "$new_events" ]]; then
    while IFS= read -r evt; do
      id="$(echo "$evt" | jq -r '.EventId')"
      if ! grep -qxF "$id" "$seen_ids_file" 2>/dev/null; then
        echo "$id" >> "$seen_ids_file"
        last_new_event_at=$(date +%s)
        ts="$(echo "$evt" | jq -r '.Timestamp')"
        res_status="$(echo "$evt" | jq -r '.ResourceStatus')"
        res_type="$(echo "$evt" | jq -r '.ResourceType')"
        logical_id="$(echo "$evt" | jq -r '.LogicalResourceId')"
        reason="$(echo "$evt" | jq -r '.ResourceStatusReason // ""')"
        printf '%s | %-22s | %-40s | %-30s | %s\n' "$ts" "$res_status" "$res_type" "$logical_id" "$reason"
      fi
    done <<< "$new_events"
  fi

  if [[ "$status" == "DELETE_FAILED" ]]; then
    echo ""
    echo "Stack is DELETE_FAILED."
    failed_ids="$(echo "$events_json" | jq -r '[.StackEvents[] | select(.ResourceStatus=="DELETE_FAILED") | .LogicalResourceId] | unique | .[]')"
    echo "Failed resources:"
    echo "$failed_ids" | sed 's/^/  - /'

    if [[ "$FORCE" -eq 1 ]]; then
      retain_args=()
      for id in $failed_ids; do
        retain_args+=(--retain-resources "$id")
      done
      echo "Forcing deletion, retaining failed resources: ${failed_ids//$'\n'/, }"
      aws cloudformation delete-stack --stack-name "$STACK_NAME" "${retain_args[@]}"
      echo "Re-issued delete-stack with --retain-resources. Continuing to watch..."
      last_new_event_at=$(date +%s)
      sleep "$INTERVAL"
      continue
    else
      echo "Re-run with --force to retry, retaining these resources so the stack can finish deleting."
      echo "(You will need to manually clean up the retained resources afterward.)"
      exit 1
    fi
  fi

  now=$(date +%s)
  if (( now - last_new_event_at > STUCK_AFTER_SEC )); then
    echo "[$(date '+%H:%M:%S')] No new events for ${STUCK_AFTER_MIN}+ minutes - stack may be stuck (current status: $status)."
    last_new_event_at=$now # avoid repeating this warning every poll
  fi

  sleep "$INTERVAL"
done
