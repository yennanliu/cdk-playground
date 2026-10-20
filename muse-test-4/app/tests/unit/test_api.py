import base64
import json

import pytest
from fastapi.testclient import TestClient

from muse.api import create_app
from muse.auth import DevAuth
from muse.sandboxes import BOOT_SECONDS, HEARTBEAT_SECONDS, Sandboxes
from muse.scheduler import Scheduler
from muse.store import token_hash
from tests.conftest import ALICE, BOB, FakeLauncher


def dev_token(sub):
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{part({'alg': 'none'})}.{part({'sub': sub})}."


@pytest.fixture
def launcher():
    return FakeLauncher()


@pytest.fixture
def sandboxes(store, launcher, clock):
    return Sandboxes(store, launcher, clock=clock)


@pytest.fixture
def app(store, sandboxes):
    return create_app(store, DevAuth(), sandboxes, {"region": "ap-northeast-1", "clientId": ""})


@pytest.fixture
def http(app):
    return TestClient(app, headers={"Authorization": f"Bearer {dev_token(ALICE)}"})


def test_page_is_public_and_configured(app):
    r = TestClient(app).get("/")
    assert r.status_code == 200 and '"clientId": ""' in r.text and "/*CONFIG*/" not in r.text


def test_api_needs_a_user(app):
    assert TestClient(app).get("/tasks").status_code == 401
    bad = TestClient(app, headers={"Authorization": f"Bearer {dev_token('../etc')}"})
    assert bad.get("/tasks").status_code == 401


# --- chat and the session manager -----------------------------------------------------------
def test_chat_queues_a_turn_and_starts_one_sandbox(http, store, launcher):
    r = http.post("/chat", json={"message": "hi"})
    assert r.status_code == 202 and r.json()["status"] == "queued"
    http.post("/chat", json={"message": "again"})
    assert [user for user, _ in launcher.launched] == [ALICE]
    assert http.get("/sandbox").json()["status"] == "starting"
    assert http.get(f"/chat/{r.json()['id']}").json()["status"] == "queued"
    assert [t["message"] for t in http.get("/chat").json()] == ["hi", "again"]


def test_sandbox_token_is_stored_hashed(http, store, launcher):
    http.post("/chat", json={"message": "hi"})
    (_, token), box = launcher.launched[0], store.sandbox(ALICE)
    assert token.startswith(f"{ALICE}.") and box["token_hash"] == token_hash(token) and box["task"] == "task-1"


def test_a_sandbox_that_stops_heartbeating_is_replaced(http, store, launcher, clock):
    http.post("/chat", json={"message": "one"})
    (_, token) = launcher.launched[0]
    store.touch_sandbox(ALICE, token_hash(token))
    store.claim_turn(ALICE)
    clock.now += HEARTBEAT_SECONDS + 1
    assert http.get("/sandbox").json()["status"] == "lost"

    http.post("/chat", json={"message": "two"})
    assert len(launcher.launched) == 2 and launcher.stopped == ["task-1"]
    first, second = http.get("/chat").json()
    assert first["status"] == "failed" and "stopped before finishing" in first["reply"]
    assert second["status"] == "queued"  # waits for the new sandbox


def test_a_sandbox_that_never_boots_is_replaced(http, launcher, clock):
    http.post("/chat", json={"message": "one"})
    clock.now += BOOT_SECONDS + 1
    turn_id = http.post("/chat", json={"message": "two"}).json()["id"]
    assert len(launcher.launched) == 2
    clock.now += BOOT_SECONDS + 1
    http.get(f"/chat/{turn_id}")  # polling a waiting turn keeps the user's sandbox alive
    assert len(launcher.launched) == 3


def test_a_stopped_sandbox_is_restarted_without_failing_anything(http, store, launcher):
    turn_id = http.post("/chat", json={"message": "one"}).json()["id"]
    store.claim_turn(ALICE)
    store.finish_turn(ALICE, turn_id, "done")
    assert store.stop_sandbox(ALICE, token_hash(launcher.launched[0][1]))
    http.post("/chat", json={"message": "two"})
    assert len(launcher.launched) == 2 and launcher.stopped == []


def test_launch_failure_is_a_503_and_retried_next_time(store, app, clock):
    failing = Sandboxes(store, FakeLauncher(error=RuntimeError("no capacity")), clock=clock)
    http = TestClient(
        create_app(store, DevAuth(), failing, {}), headers={"Authorization": f"Bearer {dev_token(ALICE)}"}
    )
    r = http.post("/chat", json={"message": "hi"})
    assert r.status_code == 503 and "no capacity" in r.json()["detail"]
    assert http.get("/sandbox").json()["status"] == "stopped"


def test_chat_validation(http):
    assert http.post("/chat", json={"message": ""}).status_code == 422
    assert http.post("/chat", json={"message": "x", "session": "Bad Name"}).status_code == 422
    assert http.get("/chat/nope").status_code == 404


def test_users_are_isolated(http, app, store):
    turn_id = http.post("/chat", json={"message": "secret"}).json()["id"]
    bob = TestClient(app, headers={"Authorization": f"Bearer {dev_token(BOB)}"})
    assert bob.get(f"/chat/{turn_id}").status_code == 404
    assert bob.get("/chat").json() == []


# --- the side panels ------------------------------------------------------------------------
def test_approvals(http, store):
    store.request_domain(ALICE, "example.com")
    assert http.get("/approvals").json()[0]["status"] == "pending"
    assert http.post("/approvals/example.com", json={"approve": True}).json()["status"] == "approved"
    assert http.post("/approvals/other.com", json={"approve": True}).status_code == 404
    assert http.get("/audit").json()[0]["event"] == "approval"


def test_settings(http):
    assert http.get("/settings").json() == {"auto_allow": False}
    assert http.put("/settings", json={"auto_allow": True}).json() == {"auto_allow": True}


def test_tasks(http):
    task_id = http.post("/tasks", json={"prompt": "news", "every_minutes": 60}).json()["id"]
    assert http.get("/tasks").json()[0]["prompt"] == "news"
    assert http.post("/tasks", json={"prompt": "x", "every_minutes": 0}).status_code == 422
    assert http.delete(f"/tasks/{task_id}").status_code == 204
    assert http.delete(f"/tasks/{task_id}").status_code == 404


def test_memories(http, store, embedder):
    memory_id = store.remember(ALICE, "likes tea", embedder.embed("likes tea"))
    assert http.get("/memories").json() == [{"id": memory_id, "text": "likes tea", "created": store.clock()}]
    assert http.delete(f"/memories/{memory_id}").status_code == 204
    assert http.delete(f"/memories/{memory_id}").status_code == 404


# --- the scheduler --------------------------------------------------------------------------
def test_due_tasks_become_turns_for_their_users_sandbox(store, sandboxes, launcher, clock):
    a = store.add_task(ALICE, "news", 60)
    store.add_task(BOB, "prices", 30)
    scheduler = Scheduler(store, sandboxes, clock=clock)

    assert scheduler.tick() == 2
    assert sorted(user for user, _ in launcher.launched) == sorted([ALICE, BOB])
    turn = store.claim_turn(ALICE)
    assert turn["task_id"] == a and turn["session"] == f"task-{a}" and turn["message"] == "news"
    assert scheduler.tick() == 0  # not due again for an hour
    clock.now += 30 * 60
    assert scheduler.tick() == 1  # Bob's half-hourly one
