import datetime as dt
import json

import pytest

from muse.api import Api
from tests.conftest import ALICE, BOB, not_found


class FakeMemory:
    """bedrock-agentcore memory record APIs, keyed by record ID."""

    def __init__(self, records):
        self.records = records  # id -> (namespace, text)
        self.deleted = []

    def list_memory_records(self, memoryId, namespace, maxResults):
        assert memoryId == "mem-1"
        return {
            "memoryRecordSummaries": [
                {"memoryRecordId": rid, "content": {"text": text}, "createdAt": dt.datetime(2026, 10, 1, i)}
                for i, (rid, (ns, text)) in enumerate(self.records.items())
                if ns == namespace
            ]
        }

    def get_memory_record(self, memoryId, memoryRecordId):
        if memoryRecordId not in self.records:
            raise not_found("GetMemoryRecord")
        return {"memoryRecord": {"memoryRecordId": memoryRecordId, "namespaces": [self.records[memoryRecordId][0]]}}

    def delete_memory_record(self, memoryId, memoryRecordId):
        self.deleted.append(memoryRecordId)


@pytest.fixture
def memory():
    return FakeMemory(
        {
            "mem-a1": (f"/users/{ALICE}/facts", "Alice lives in Taipei"),
            "mem-a2": (f"/users/{ALICE}/preferences", "Alice prefers tea"),
            "mem-b1": (f"/users/{BOB}/facts", "Bob has a cat"),
        }
    )


@pytest.fixture
def started():
    return []


@pytest.fixture
def api(store, tasks, memory, started):
    return Api(store, tasks, memory, "mem-1", started.append, {"region": "ap-northeast-1", "clientId": "abc"})


def request(api, method, path, body=None, user=ALICE):
    context = {"http": {"method": method}}
    if user:
        context["authorizer"] = {"jwt": {"claims": {"sub": user}}}
    event = {"rawPath": path, "requestContext": context, "body": json.dumps(body) if body is not None else None}
    response = api.handle(event)
    return response["statusCode"], json.loads(response["body"]) if "body" in response else None


def test_ui_is_served_with_its_config_and_without_auth(api):
    response = api.handle({"rawPath": "/", "requestContext": {"http": {"method": "GET"}}})
    assert response["statusCode"] == 200
    assert '"clientId": "abc"' in response["body"] and "/*CONFIG*/" not in response["body"]


def test_everything_else_needs_a_user(api):
    assert request(api, "GET", "/tasks", user=None)[0] == 401


def test_unknown_route(api):
    assert request(api, "GET", "/nope")[0] == 404
    assert request(api, "PUT", "/tasks")[0] == 404


def test_chat_starts_a_turn_on_the_worker_and_can_be_polled(api, store, started):
    status, body = request(api, "POST", "/chat", {"message": "hi"})
    assert status == 202
    assert started == [{"turn": {"user": ALICE, "id": body["id"]}}]

    store.finish_turn(ALICE, body["id"], "hello")
    assert request(api, "GET", f"/chat/{body['id']}")[1] == {
        "id": body["id"],
        "session": "default",
        "status": "done",
        "message": "hi",
        "reply": "hello",
    }
    assert request(api, "GET", f"/chat/{body['id']}", user=BOB)[0] == 404


@pytest.mark.parametrize("body", [{}, {"message": " "}, {"message": "hi", "session": "../x"}, {"message": 3}])
def test_chat_validates_input(api, body, started):
    assert request(api, "POST", "/chat", body)[0] == 400
    assert started == []


def test_memories_are_only_the_users_own(api):
    status, records = request(api, "GET", "/memories")
    assert status == 200
    assert [(r["id"], r["kind"]) for r in records] == [("mem-a1", "facts"), ("mem-a2", "preferences")]


def test_forget_only_the_users_own_memory(api, memory):
    assert request(api, "DELETE", "/memories/mem-b1")[0] == 404
    assert request(api, "DELETE", "/memories/mem-zz")[0] == 404
    assert request(api, "DELETE", "/memories/mem-a1")[0] == 204
    assert memory.deleted == ["mem-a1"]


def test_approve_a_pending_domain(api, store):
    store.request_domain(ALICE, "example.com")
    assert request(api, "GET", "/approvals")[1][0]["status"] == "pending"
    status, decided = request(api, "POST", "/approvals/example.com", {"approve": True})
    assert (status, decided["status"]) == (200, "approved")
    assert store.approved_domains(ALICE) == {"example.com"}


def test_cannot_decide_another_users_or_unknown_domain(api, store):
    store.request_domain(BOB, "example.com")
    assert request(api, "POST", "/approvals/example.com", {"approve": True})[0] == 404
    assert request(api, "POST", "/approvals/example.com", {"approve": "yes"}, user=BOB)[0] == 400
    assert store.approved_domains(BOB) == set()


def test_tasks_crud(api, scheduler):
    status, body = request(api, "POST", "/tasks", {"prompt": "news digest", "every_minutes": 60})
    assert status == 201 and len(scheduler.schedules) == 1
    assert [t["id"] for t in request(api, "GET", "/tasks")[1]] == [body["id"]]
    assert request(api, "DELETE", f"/tasks/{body['id']}", user=BOB)[0] == 404
    assert request(api, "DELETE", f"/tasks/{body['id']}")[0] == 204
    assert scheduler.schedules == {} and request(api, "GET", "/tasks")[1] == []


@pytest.mark.parametrize("every", [0, -5, "60", True, None])
def test_task_interval_must_be_a_positive_int(api, every):
    assert request(api, "POST", "/tasks", {"prompt": "x", "every_minutes": every})[0] == 400


def test_audit_is_json_serializable(api, store):
    store.audit(ALICE, "tool", {"name": "browse", "n": 3})
    status, log = request(api, "GET", "/audit")
    assert status == 200 and log[0]["detail"] == {"name": "browse", "n": 3}


def test_bad_json_is_400(api):
    event = {
        "rawPath": "/chat",
        "body": "{nope",
        "requestContext": {"http": {"method": "POST"}, "authorizer": {"jwt": {"claims": {"sub": ALICE}}}},
    }
    assert api.handle(event)["statusCode"] == 400
