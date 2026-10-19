"""The worker Lambda: runs one agent turn against AgentCore Runtime and records the result.

Chat turns arrive as async invokes from the API (API Gateway gives up after 30 s;
a turn that browses can take minutes). Scheduled tasks arrive from EventBridge
Scheduler. Neither is retried: a retried turn could repeat the agent's actions.
"""

import functools
import json
import logging
import os

from muse.config import Config

log = logging.getLogger(__name__)


def runtime_session(user, session):
    """A Cognito sub is 36 chars, so this clears AgentCore's 33-char minimum; one microVM per user session."""
    return f"{user}-{session}"


class Runtime:
    def __init__(self, arn, client):
        self.arn = arn
        self.client = client

    def invoke(self, user, session, prompt, background=False):
        runtime_session_id = runtime_session(user, session)
        response = self.client.invoke_agent_runtime(
            agentRuntimeArn=self.arn,
            runtimeSessionId=runtime_session_id,
            payload=json.dumps(
                {"user": user, "session": runtime_session_id, "prompt": prompt, "background": background}
            ).encode(),
        )
        return json.loads(response["response"].read())["reply"]


class Worker:
    def __init__(self, store, runtime):
        self.store = store
        self.runtime = runtime

    def handle(self, event):
        if "turn" in event:
            return self.run_turn(event["turn"]["user"], event["turn"]["id"])
        if "task" in event:
            return self.run_task(event["task"]["user"], event["task"]["id"])
        raise ValueError(f"unknown event: {event}")

    def run_turn(self, user, turn_id):
        turn = self.store.turn(user, turn_id)
        if not turn or turn["status"] != "running":
            return None
        try:
            reply, ok = self.runtime.invoke(user, turn["session"], turn["message"]), True
        except Exception as e:  # recorded on the turn so the user sees it
            log.exception("turn %s failed", turn_id)
            reply, ok = f"The agent failed: {e}", False
        self.store.finish_turn(user, turn_id, reply, ok)
        self.store.audit(user, "turn", {"id": turn_id, "ok": ok})
        return reply

    def run_task(self, user, task_id):
        task = self.store.task(user, task_id)
        if not task:  # deleted, but its schedule fired once more
            return None
        try:
            result = self.runtime.invoke(user, f"task-{task_id}", task["prompt"], background=True)
        except Exception as e:  # recorded on the task; the next tick runs again
            log.exception("task %s failed", task_id)
            result = f"Failed: {e}"
            self.store.audit(user, "task_failed", {"id": task_id, "error": str(e)})
        self.store.finish_task(user, task_id, result)
        return result


@functools.cache
def _worker():
    import boto3
    from botocore.config import Config as BotoConfig

    from muse.store import Store

    config = Config.from_env(os.environ)
    # An agent turn can run for minutes; never retry it.
    client = boto3.client("bedrock-agentcore", config=BotoConfig(read_timeout=900, retries={"total_max_attempts": 1}))
    return Worker(Store(boto3.resource("dynamodb").Table(config.table)), Runtime(config.runtime_arn, client))


def handler(event, _context):
    _worker().handle(event)
