"""Muse's own state in one DynamoDB table, partitioned by user (the Cognito `sub`).

Sort keys: `settings`, `approval#<domain>`, `turn#<id>`, `task#<id>`, `audit#<time>`.
Conversation history and long-term memory are not here: AgentCore Memory keeps those.
"""

import time
import uuid
from decimal import Decimal

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

DAY = 86400


def _plain(item):
    """DynamoDB numbers come back as Decimal; JSON wants int/float."""
    return {
        k: (int(v) if v == v.to_integral_value() else float(v)) if isinstance(v, Decimal) else v
        for k, v in item.items()
    }


def _id():
    return uuid.uuid4().hex[:12]


class Store:
    def __init__(self, table, clock=time.time):
        self.table = table
        self.clock = clock

    def _get(self, user, sk):
        item = self.table.get_item(Key={"user": user, "sk": sk}, ConsistentRead=True).get("Item")
        return _plain(item) if item else None

    def _query(self, user, prefix, newest_first=False, limit=None):
        # Consistent: the UI reads right after its own writes (approve, then refresh the list).
        kwargs = {
            "KeyConditionExpression": Key("user").eq(user) & Key("sk").begins_with(prefix),
            "ConsistentRead": True,
        }
        if newest_first:
            kwargs["ScanIndexForward"] = False
        if limit:
            kwargs["Limit"] = limit
        return [_plain(i) for i in self.table.query(**kwargs)["Items"]]

    def _update(self, user, sk, **values):
        """Set fields on an existing item; None if it does not exist."""
        names = {f"#{k}": k for k in values}
        try:
            item = self.table.update_item(
                Key={"user": user, "sk": sk},
                UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in values),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues={f":{k}": v for k, v in values.items()},
                ConditionExpression="attribute_exists(sk)",
                ReturnValues="ALL_NEW",
            )["Attributes"]
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return None
            raise
        return _plain(item)

    def _delete(self, user, sk):
        return "Attributes" in self.table.delete_item(Key={"user": user, "sk": sk}, ReturnValues="ALL_OLD")

    # --- settings ---------------------------------------------------------------
    def settings(self, user):
        item = self._get(user, "settings") or {}
        return {"auto_allow": bool(item.get("auto_allow", False))}

    def update_settings(self, user, auto_allow):
        self.table.put_item(Item={"user": user, "sk": "settings", "auto_allow": auto_allow})
        return self.settings(user)

    # --- sentinel: domain approvals -----------------------------------------
    def approved_domains(self, user):
        return {a["domain"] for a in self.approvals(user) if a["status"] == "approved"}

    def request_domain(self, user, domain):
        """Ask the user about a domain once; a denied or approved domain keeps its decision."""
        try:
            self.table.put_item(
                Item={
                    "user": user,
                    "sk": f"approval#{domain}",
                    "domain": domain,
                    "status": "pending",
                    "created": Decimal(str(self.clock())),
                },
                ConditionExpression="attribute_not_exists(sk)",
            )
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
        return self._get(user, f"approval#{domain}")

    def approvals(self, user):
        return self._query(user, "approval#")

    def decide(self, user, domain, approve):
        return self._update(user, f"approval#{domain}", status="approved" if approve else "denied")

    # --- chat turns (run asynchronously by the worker) -----------------------
    def start_turn(self, user, session, message):
        turn_id = _id()
        now = self.clock()
        self.table.put_item(
            Item={
                "user": user,
                "sk": f"turn#{turn_id}",
                "id": turn_id,
                "session": session,
                "message": message,
                "status": "running",
                "created": Decimal(str(now)),
                "expires": int(now + 7 * DAY),
            }
        )
        return turn_id

    def turns(self, user, session, limit=50):
        """The newest turns of one session, oldest first."""
        turns = [t for t in self._query(user, "turn#") if t["session"] == session]
        return sorted(turns, key=lambda t: t["created"])[-limit:]

    def turn(self, user, turn_id):
        return self._get(user, f"turn#{turn_id}")

    def finish_turn(self, user, turn_id, reply, ok=True):
        return self._update(user, f"turn#{turn_id}", reply=reply, status="done" if ok else "failed")

    # --- background tasks (EventBridge Scheduler fires them) -----------------
    def add_task(self, user, prompt, every_minutes):
        task_id = _id()
        self.table.put_item(
            Item={
                "user": user,
                "sk": f"task#{task_id}",
                "id": task_id,
                "prompt": prompt,
                "every_minutes": every_minutes,
                "created": Decimal(str(self.clock())),
            }
        )
        return task_id

    def tasks(self, user):
        return self._query(user, "task#")

    def task(self, user, task_id):
        return self._get(user, f"task#{task_id}")

    def finish_task(self, user, task_id, result):
        return self._update(user, f"task#{task_id}", last_result=result, last_run=Decimal(str(self.clock())))

    def delete_task(self, user, task_id):
        return self._delete(user, f"task#{task_id}")

    # --- audit trail ----------------------------------------------------------
    def audit(self, user, event, detail):
        now = self.clock()
        self.table.put_item(
            Item={
                "user": user,
                "sk": f"audit#{int(now * 1e6):020d}#{_id()[:4]}",
                "at": Decimal(str(now)),
                "event": event,
                "detail": detail,
                "expires": int(now + 90 * DAY),
            }
        )

    def audit_log(self, user, limit=100):
        return self._query(user, "audit#", newest_first=True, limit=limit)
