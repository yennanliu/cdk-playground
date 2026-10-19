"""The API Lambda behind API Gateway (HTTP API, Cognito JWT authorizer).

The user is always the token's `sub`, which API Gateway has already verified;
nothing in the request body can name another user. `GET /` serves the web UI
without auth, and the page signs in with Cognito itself.
"""

import functools
import json
import logging
import os
import re
from pathlib import Path

from botocore.exceptions import ClientError

from muse.config import MEMORY_NAMESPACES, Config

log = logging.getLogger(__name__)
UI = Path(__file__).parent / "static" / "index.html"
SESSION = re.compile(r"^[a-z0-9-]{1,40}$")


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def _number(value):
    """Nested DynamoDB numbers (e.g. in audit details) are still Decimal."""
    return int(value) if value == value.to_integral_value() else float(value)


def _json(status, body=None):
    if body is None:
        return {"statusCode": status}
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, default=_number),
    }


def _text(body, field, kind=str):
    value = body.get(field)
    if not isinstance(value, kind) or (kind is str and not value.strip()):
        raise HttpError(400, f"'{field}' is required")
    return value


class Api:
    def __init__(self, store, tasks, memory, memory_id, start_worker, ui_config):
        self.store = store
        self.tasks = tasks
        self.memory = memory  # boto3 bedrock-agentcore client
        self.memory_id = memory_id
        self.start_worker = start_worker
        self.ui_config = ui_config
        self.routes = [
            ("POST", r"/chat", self.chat),
            ("GET", r"/chat/(?P<turn_id>\w+)", self.turn),
            ("GET", r"/memories", self.memories),
            ("DELETE", r"/memories/(?P<record_id>[\w-]+)", self.forget),
            ("GET", r"/approvals", self.approvals),
            ("POST", r"/approvals/(?P<domain>[a-z0-9.-]+)", self.decide),
            ("GET", r"/tasks", self.list_tasks),
            ("POST", r"/tasks", self.add_task),
            ("DELETE", r"/tasks/(?P<task_id>\w+)", self.delete_task),
            ("GET", r"/audit", self.audit),
        ]

    def handle(self, event):
        method, path = event["requestContext"]["http"]["method"], event["rawPath"]
        if method == "GET" and path == "/":
            return self.ui()
        try:
            user = event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
        except KeyError:
            return _json(401, {"detail": "unauthorized"})
        try:
            body = json.loads(event.get("body") or "{}")
        except json.JSONDecodeError:
            return _json(400, {"detail": "body must be JSON"})
        for route_method, pattern, handler in self.routes:
            if method == route_method and (match := re.fullmatch(pattern, path)):
                try:
                    return handler(user, body, **match.groupdict())
                except HttpError as e:
                    return _json(e.status, {"detail": str(e)})
        return _json(404, {"detail": "not found"})

    def ui(self):
        html = UI.read_text().replace("/*CONFIG*/{}", json.dumps(self.ui_config))
        return {"statusCode": 200, "headers": {"content-type": "text/html; charset=utf-8"}, "body": html}

    # --- chat: start a turn, then poll it --------------------------------------
    def chat(self, user, body):
        message = _text(body, "message")
        session = body.get("session", "default")
        if not isinstance(session, str) or not SESSION.match(session):
            raise HttpError(400, "'session' must be 1-40 chars of a-z, 0-9 and '-'")
        turn_id = self.store.start_turn(user, session, message)
        self.start_worker({"turn": {"user": user, "id": turn_id}})
        return _json(202, {"id": turn_id, "status": "running"})

    def turn(self, user, _body, turn_id):
        turn = self.store.turn(user, turn_id)
        if not turn:
            raise HttpError(404, "no such turn")
        return _json(200, {k: turn.get(k) for k in ("id", "session", "status", "message", "reply")})

    # --- long-term memory (AgentCore Memory) ----------------------------------
    def memories(self, user, _body):
        records = []
        for template in MEMORY_NAMESPACES:
            namespace = template.format(actorId=user)
            response = self.memory.list_memory_records(memoryId=self.memory_id, namespace=namespace, maxResults=100)
            records += [
                {
                    "id": r["memoryRecordId"],
                    "text": r["content"]["text"],
                    "kind": namespace.rsplit("/", 1)[-1],
                    "created": r["createdAt"].isoformat(),
                }
                for r in response["memoryRecordSummaries"]
            ]
        return _json(200, sorted(records, key=lambda r: r["created"]))

    def forget(self, user, _body, record_id):
        try:
            record = self.memory.get_memory_record(memoryId=self.memory_id, memoryRecordId=record_id)["memoryRecord"]
        except ClientError as e:
            if e.response["Error"]["Code"] in ("ResourceNotFoundException", "ValidationException"):
                raise HttpError(404, "no such memory")
            raise
        if not any(ns.startswith(f"/users/{user}/") for ns in record["namespaces"]):
            raise HttpError(404, "no such memory")  # someone else's: indistinguishable from missing
        self.memory.delete_memory_record(memoryId=self.memory_id, memoryRecordId=record_id)
        self.store.audit(user, "memory_forgotten", {"id": record_id})
        return _json(204)

    # --- approvals --------------------------------------------------------------
    def approvals(self, user, _body):
        return _json(200, sorted(self.store.approvals(user), key=lambda a: -a["created"]))

    def decide(self, user, body, domain):
        approve = _text(body, "approve", bool)
        decided = self.store.decide(user, domain, approve)
        if not decided:
            raise HttpError(404, "no such approval")
        self.store.audit(user, "approval", {"domain": domain, "status": decided["status"]})
        return _json(200, decided)

    # --- background tasks --------------------------------------------------------
    def list_tasks(self, user, _body):
        return _json(200, self.store.tasks(user))

    def add_task(self, user, body):
        prompt = _text(body, "prompt")
        every = body.get("every_minutes")
        if not isinstance(every, int) or isinstance(every, bool) or every < 1:
            raise HttpError(400, "'every_minutes' must be a positive integer")
        return _json(201, {"id": self.tasks.add(user, prompt, every)})

    def delete_task(self, user, _body, task_id):
        if not self.tasks.delete(user, task_id):
            raise HttpError(404, "no such task")
        return _json(204)

    def audit(self, user, _body):
        return _json(200, self.store.audit_log(user))


@functools.cache
def _api():
    import boto3

    from muse.store import Store
    from muse.tasks import Tasks

    config = Config.from_env(os.environ)
    store = Store(boto3.resource("dynamodb").Table(config.table))
    tasks = Tasks(store, boto3.client("scheduler"), config.schedule_group, config.worker_arn, config.scheduler_role_arn)
    lam = boto3.client("lambda")

    def start_worker(event):
        lam.invoke(FunctionName=config.worker_arn, InvocationType="Event", Payload=json.dumps(event))

    ui_config = {"region": config.region, "clientId": config.user_pool_client_id}
    return Api(store, tasks, boto3.client("bedrock-agentcore"), config.memory_id, start_worker, ui_config)


def handler(event, _context):
    try:
        return _api().handle(event)
    except Exception:
        log.exception("request failed")
        return _json(500, {"detail": "internal error"})
