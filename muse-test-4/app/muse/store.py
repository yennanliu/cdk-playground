"""All of Muse's state, in one DynamoDB table partitioned by user (the Cognito `sub`).

Sort keys:

  settings              auto-allow switch
  sandbox               the user's current sandbox: token hash, task, status, heartbeat
  approval#<domain>     per-user domain approvals
  turn#<id>             a chat message or task run, and its reply
  queue#<turn id>       present while that turn waits for the sandbox
  history#<session>     the model's message list for one chat
  memory#<id>           long-term memory: text + embedding
  task#<id>             background task; also in the sparse `due` index the scheduler reads
  audit#<time>          the activity trail

Only the api and the sentinel use this; sandboxes have no access to the table.
Ids are time-ordered, so `queue#` items come back oldest first.
"""

import hashlib
import itertools
import json
import secrets
import time
import uuid
from array import array
from decimal import Decimal

from boto3.dynamodb.conditions import Attr, Key
from boto3.dynamodb.types import Binary
from botocore.exceptions import ClientError

DAY = 86400
DUE_INDEX = "due"
_sequence = itertools.count()


def _plain(item):
    """DynamoDB numbers come back as Decimal; JSON wants int/float."""
    return {
        k: (int(v) if v == v.to_integral_value() else float(v)) if isinstance(v, Decimal) else v
        for k, v in item.items()
    }


def _num(value):
    return Decimal(str(value))


def _failed(e, code):
    return e.response["Error"]["Code"] == code


def new_token(user):
    """A sandbox's credential for the sentinel. It names its user; the sentinel checks the rest."""
    return f"{user}.{secrets.token_urlsafe(24)}"


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def create_table(client, name):
    """Local runs and tests only; the stack creates the real one with the same schema."""
    try:
        client.create_table(
            TableName=name,
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[{"AttributeName": "user", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            AttributeDefinitions=[
                {"AttributeName": n, "AttributeType": t}
                for n, t in (("user", "S"), ("sk", "S"), ("due", "S"), ("next_run", "N"))
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": DUE_INDEX,
                    "KeySchema": [
                        {"AttributeName": "due", "KeyType": "HASH"},
                        {"AttributeName": "next_run", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
        )
    except ClientError as e:
        if not _failed(e, "ResourceInUseException"):
            raise


def connect(config, create=False):
    import boto3

    db = boto3.resource("dynamodb", region_name=config.region, endpoint_url=config.dynamodb_endpoint)
    if create:
        create_table(db.meta.client, config.table)
    return Store(db.Table(config.table))


class Store:
    def __init__(self, table, clock=time.time):
        self.table = table
        self.clock = clock

    def new_id(self):
        """Sorts by creation time (and by order within a millisecond, in this process); unique across processes."""
        return f"{int(self.clock() * 1000):012x}{next(_sequence) % 0x10000:04x}{uuid.uuid4().hex[:4]}"

    # --- primitives -------------------------------------------------------------
    def _get(self, user, sk):
        item = self.table.get_item(Key={"user": user, "sk": sk}, ConsistentRead=True).get("Item")
        return _plain(item) if item else None

    def _query(self, user, prefix, newest_first=False, limit=None, where=None):
        # Consistent: callers read right after their own writes (approve, then list).
        kwargs = {
            "KeyConditionExpression": Key("user").eq(user) & Key("sk").begins_with(prefix),
            "ConsistentRead": True,
            "ScanIndexForward": not newest_first,
        }
        if limit:
            kwargs["Limit"] = limit
        if where is not None:
            kwargs["FilterExpression"] = where
        items = []
        while True:
            page = self.table.query(**kwargs)
            items += page["Items"]
            if limit or "LastEvaluatedKey" not in page:
                return [_plain(i) for i in items]
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def _update(self, user, sk, condition=None, **values):
        """Set fields on an existing item; None if it does not exist or `condition` fails."""
        try:
            item = self.table.update_item(
                Key={"user": user, "sk": sk},
                UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in values),
                ExpressionAttributeNames={f"#{k}": k for k in values},
                ExpressionAttributeValues={f":{k}": v for k, v in values.items()},
                ConditionExpression=condition if condition is not None else Attr("sk").exists(),
                ReturnValues="ALL_NEW",
            )["Attributes"]
        except ClientError as e:
            if _failed(e, "ConditionalCheckFailedException"):
                return None
            raise
        return _plain(item)

    def _delete(self, user, sk):
        return "Attributes" in self.table.delete_item(Key={"user": user, "sk": sk}, ReturnValues="ALL_OLD")

    def _transact(self, *ops):
        """TransactWriteItems on this table. The resource's client takes plain Python values here too."""
        items = [{kind: {**body, "TableName": self.table.name}} for op in ops for kind, body in op.items()]
        self.table.meta.client.transact_write_items(TransactItems=items)

    # --- settings -----------------------------------------------------------------
    def settings(self, user):
        item = self._get(user, "settings") or {}
        return {"auto_allow": bool(item.get("auto_allow", False))}

    def update_settings(self, user, auto_allow):
        self.table.put_item(Item={"user": user, "sk": "settings", "auto_allow": auto_allow})
        return self.settings(user)

    # --- the user's sandbox ---------------------------------------------------------
    def sandbox(self, user):
        return self._get(user, "sandbox")

    def replace_sandbox(self, user, old_hash, new_hash):
        """Record a new, starting sandbox, unless another caller just did. True if this call won."""
        try:
            self.table.put_item(
                Item={
                    "user": user,
                    "sk": "sandbox",
                    "token_hash": new_hash,
                    "status": "starting",
                    "started": _num(self.clock()),
                },
                ConditionExpression=Attr("sk").not_exists() if old_hash is None else Attr("token_hash").eq(old_hash),
            )
        except ClientError as e:
            if _failed(e, "ConditionalCheckFailedException"):
                return False
            raise
        return True

    def update_sandbox(self, user, hash_, **values):
        """Update the record if it is still this sandbox's; None once it has been replaced."""
        return self._update(user, "sandbox", Attr("token_hash").eq(hash_), **values)

    def touch_sandbox(self, user, hash_):
        """A heartbeat. False if the sandbox was replaced or has signed off."""
        live = Attr("token_hash").eq(hash_) & Attr("status").is_in(["starting", "running"])
        return self._update(user, "sandbox", live, status="running", seen=_num(self.clock())) is not None

    def stop_sandbox(self, user, hash_):
        """The sandbox is idle and wants to stop. False means stay: a turn arrived meanwhile.

        Marking it stopped *before* looking at the queue pairs with the api, which
        queues a turn *before* reading this record: either the api sees "stopped" and
        starts a new sandbox, or this sees the turn and the sandbox stays.
        """
        if not self.update_sandbox(user, hash_, status="stopped"):
            return True  # already replaced
        if not self.has_queued(user):
            return True
        return not self.update_sandbox(user, hash_, status="running", seen=_num(self.clock()))

    # --- domain approvals -----------------------------------------------------------
    def approvals(self, user):
        return [{k: a[k] for k in ("domain", "status", "created")} for a in self._query(user, "approval#")]

    def request_domain(self, user, domain):
        """Ask the user about a domain once; a denied or approved domain keeps its decision."""
        try:
            self.table.put_item(
                Item={
                    "user": user,
                    "sk": f"approval#{domain}",
                    "domain": domain,
                    "status": "pending",
                    "created": _num(self.clock()),
                },
                ConditionExpression=Attr("sk").not_exists(),
            )
        except ClientError as e:
            if not _failed(e, "ConditionalCheckFailedException"):
                raise
        return self._get(user, f"approval#{domain}")

    def decide(self, user, domain, approve):
        decided = self._update(user, f"approval#{domain}", status="approved" if approve else "denied")
        return decided and {k: decided[k] for k in ("domain", "status", "created")}

    # --- turns: queued by the api, run by the user's sandbox ------------------------
    def enqueue_turn(self, user, session, message, task_id=None):
        turn_id, now = self.new_id(), self.clock()
        turn = {
            "user": user,
            "sk": f"turn#{turn_id}",
            "id": turn_id,
            "session": session,
            "message": message,
            "status": "queued",
            "created": _num(now),
            "expires": int(now + 7 * DAY),
        }
        if task_id:
            turn["task_id"] = task_id
        marker = {"user": user, "sk": f"queue#{turn_id}", "expires": int(now + 7 * DAY)}
        self._transact({"Put": {"Item": turn}}, {"Put": {"Item": marker}})
        return turn_id

    def has_queued(self, user):
        return bool(self._query(user, "queue#", limit=1))

    def claim_turn(self, user):
        """Take this user's oldest queued turn, or None. No two callers get the same one."""
        for marker in self._query(user, "queue#", limit=5):
            turn_id = marker["sk"].removeprefix("queue#")
            try:
                self._transact(
                    {
                        "Delete": {
                            "Key": {"user": user, "sk": marker["sk"]},
                            "ConditionExpression": "attribute_exists(sk)",
                        }
                    },
                    {
                        "Update": {
                            "Key": {"user": user, "sk": f"turn#{turn_id}"},
                            "UpdateExpression": "SET #status = :running, started = :now",
                            "ExpressionAttributeNames": {"#status": "status"},
                            "ExpressionAttributeValues": {":running": "running", ":now": _num(self.clock())},
                        }
                    },
                )
            except ClientError as e:
                if _failed(e, "TransactionCanceledException"):
                    continue  # someone else took it
                raise
            return self.turn(user, turn_id)
        return None

    def turn(self, user, turn_id):
        return self._get(user, f"turn#{turn_id}")

    def turns(self, user, session, limit=50):
        """The newest turns of one chat, oldest first."""
        return self._query(user, "turn#", where=Attr("session").eq(session))[-limit:]

    def finish_turn(self, user, turn_id, reply, ok=True):
        return self._update(
            user, f"turn#{turn_id}", status="done" if ok else "failed", reply=reply, finished=_num(self.clock())
        )

    def fail_running(self, user, reply):
        """Fail the turns a dead sandbox was running. Queued turns wait for the next sandbox."""
        running = self._query(user, "turn#", where=Attr("status").eq("running"))
        for turn in running:
            self.finish_turn(user, turn["id"], reply, ok=False)
        return len(running)

    # --- chat history (the model's view of a chat) ----------------------------------
    def history(self, user, session):
        item = self._get(user, f"history#{session}")
        return json.loads(item["messages"]) if item else []

    def save_history(self, user, session, messages):
        self.table.put_item(Item={"user": user, "sk": f"history#{session}", "messages": json.dumps(messages)})

    # --- long-term memory -------------------------------------------------------------
    def remember(self, user, text, embedding):
        memory_id = self.new_id()
        self.table.put_item(
            Item={
                "user": user,
                "sk": f"memory#{memory_id}",
                "id": memory_id,
                "text": text,
                "embedding": Binary(array("f", embedding).tobytes()),
                "created": _num(self.clock()),
            }
        )
        return memory_id

    def memories(self, user):
        return [{k: m[k] for k in ("id", "text", "created")} for m in self._query(user, "memory#")]

    def recall(self, user, embedding, k=8):
        """The k memories closest in meaning; embeddings are normalized, so the dot product ranks them."""

        def score(memory):
            return sum(a * b for a, b in zip(embedding, array("f", memory["embedding"].value)))

        ranked = sorted(self._query(user, "memory#"), key=score, reverse=True)
        return [{k: m[k] for k in ("id", "text", "created")} for m in ranked[:k]]

    def forget(self, user, memory_id):
        return self._delete(user, f"memory#{memory_id}")

    # --- background tasks ---------------------------------------------------------------
    def add_task(self, user, prompt, every_minutes):
        """Runs first right away, then every `every_minutes`."""
        task_id, now = self.new_id(), self.clock()
        self.table.put_item(
            Item={
                "user": user,
                "sk": f"task#{task_id}",
                "id": task_id,
                "prompt": prompt,
                "every_minutes": every_minutes,
                "created": _num(now),
                "due": "task",
                "next_run": _num(now),
            }
        )
        return task_id

    def tasks(self, user):
        return [{k: v for k, v in t.items() if k not in ("user", "sk", "due")} for t in self._query(user, "task#")]

    def task(self, user, task_id):
        return self._get(user, f"task#{task_id}")

    def delete_task(self, user, task_id):
        return self._delete(user, f"task#{task_id}")

    def due_tasks(self, now):
        """Every user's tasks whose next run has come (the index is eventually consistent; advance_task decides)."""
        response = self.table.query(
            IndexName=DUE_INDEX, KeyConditionExpression=Key("due").eq("task") & Key("next_run").lte(_num(now))
        )
        return [_plain(t) for t in response["Items"]]

    def advance_task(self, task, now):
        """Move a due task to its next run. False if another scheduler already did, or it was deleted."""
        unchanged = Attr("next_run").eq(_num(task["next_run"]))
        return (
            self._update(task["user"], task["sk"], unchanged, next_run=_num(now + task["every_minutes"] * 60))
            is not None
        )

    def finish_task(self, user, task_id, result):
        return self._update(user, f"task#{task_id}", last_result=result, last_run=_num(self.clock()))

    # --- audit trail ----------------------------------------------------------------------
    def audit(self, user, event, detail):
        now = self.clock()
        self.table.put_item(
            Item={
                "user": user,
                "sk": f"audit#{int(now * 1e6):020d}#{uuid.uuid4().hex[:4]}",
                "at": _num(now),
                "event": event,
                "detail": detail,
                "expires": int(now + 90 * DAY),
            }
        )

    def audit_log(self, user, limit=100):
        return self._query(user, "audit#", newest_first=True, limit=limit)
