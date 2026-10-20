import asyncio
import base64

import httpx
import pytest
from fastapi.testclient import TestClient

from muse.sentinel import Policy, Proxy, create_gateway, refusal, sandbox_user
from muse.store import new_token, token_hash
from tests.conftest import ALICE, BOB


@pytest.fixture
def gateway(store, embedder, token):
    app = create_gateway(store, Policy(store, ["seeded.org"]), embedder, poll_seconds=0.2, tick=0.1)
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


# --- who is asking ---------------------------------------------------------------------------
def test_token_names_the_user_only_while_current(store, token):
    assert sandbox_user(store, token) == ALICE
    assert sandbox_user(store, token + "x") is None
    assert sandbox_user(store, f"{BOB}.{token.rpartition('.')[2]}") is None
    assert sandbox_user(store, None) is None
    store.replace_sandbox(ALICE, token_hash(token), token_hash(new_token(ALICE)))
    assert sandbox_user(store, token) is None  # replaced: locked out at once


def test_gateway_needs_a_current_token(gateway):
    assert gateway.post("/next", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert gateway.post("/act", json={"name": "recall", "input": {}}, headers={"Authorization": ""}).status_code == 401


# --- turns ------------------------------------------------------------------------------------
def test_next_hands_out_a_turn_with_history_and_memories(gateway, store, embedder):
    store.remember(ALICE, "I live in Taipei", embedder.embed("I live in Taipei"))
    store.save_history(ALICE, "default", [{"role": "user", "content": [{"text": "earlier"}]}])
    turn_id = store.enqueue_turn(ALICE, "default", "where do I live?")

    turn = gateway.post("/next").json()
    assert turn["id"] == turn_id and turn["kind"] == "chat" and turn["prompt"] == "where do I live?"
    assert turn["history"][0]["content"][0]["text"] == "earlier"
    assert turn["memories"][0]["text"] == "I live in Taipei"
    assert gateway.post("/next").status_code == 204  # nothing else queued


def test_next_never_hands_out_another_users_turn(gateway, store):
    store.enqueue_turn(BOB, "default", "bob's")
    assert gateway.post("/next").status_code == 204


def test_finish_saves_reply_and_history(gateway, store):
    turn_id = store.enqueue_turn(ALICE, "default", "hi")
    gateway.post("/next")
    messages = [{"role": "user", "content": [{"text": "hi"}]}, {"role": "assistant", "content": [{"text": "hey"}]}]
    assert gateway.post(f"/turns/{turn_id}", json={"reply": "hey", "messages": messages}).status_code == 204
    assert store.turn(ALICE, turn_id).items() >= {"status": "done", "reply": "hey"}.items()
    assert store.history(ALICE, "default") == messages
    assert gateway.post(f"/turns/{turn_id}", json={"reply": "again"}).status_code == 409


def test_finish_without_messages_keeps_history(gateway, store):
    store.save_history(ALICE, "default", ["before"])
    turn_id = store.enqueue_turn(ALICE, "default", "refused")
    gateway.post("/next")
    gateway.post(f"/turns/{turn_id}", json={"reply": "I can't help with that", "messages": None})
    assert store.history(ALICE, "default") == ["before"]


def test_task_runs_report_to_the_task(gateway, store):
    task_id = store.add_task(ALICE, "summarise", 60)
    turn_id = store.enqueue_turn(ALICE, f"task-{task_id}", "summarise", task_id=task_id)
    assert gateway.post("/next").json()["kind"] == "task"
    gateway.post(f"/turns/{turn_id}", json={"reply": "all quiet", "messages": ["x"]})
    assert store.task(ALICE, task_id)["last_result"] == "all quiet"
    assert store.history(ALICE, f"task-{task_id}") == []


# --- sandbox lifecycle --------------------------------------------------------------------------
def test_heartbeat_and_bye(gateway, store):
    assert gateway.post("/heartbeat").status_code == 204
    assert store.sandbox(ALICE)["status"] == "running"
    assert gateway.post("/bye").json() == {"stopped": True}
    assert gateway.post("/heartbeat").status_code == 409


def test_bye_with_work_waiting_stays(gateway, store):
    store.enqueue_turn(ALICE, "default", "hi")
    assert gateway.post("/bye").json() == {"stopped": False}


# --- browsing permission -------------------------------------------------------------------------
def permit(gateway, url):
    return gateway.post("/permit", json={"url": url}).json()["reason"]


def test_permit_asks_once_then_follows_the_decision(gateway, store):
    assert "approval request was sent" in permit(gateway, "https://example.com/a")
    assert store.approvals(ALICE)[0]["domain"] == "example.com"
    store.decide(ALICE, "example.com", True)
    assert permit(gateway, "https://example.com/b") is None
    assert permit(gateway, "https://www.example.com/") is None  # subdomains of an approved domain
    store.decide(ALICE, "example.com", False)
    assert "denied" in permit(gateway, "https://example.com/")


def test_permit_seeded_and_refused(gateway):
    assert permit(gateway, "https://docs.seeded.org/") is None
    for url in ("file:///etc/passwd", "http://169.254.169.254/latest/", "http://10.0.0.5/", "http://localhost:8080/"):
        assert permit(gateway, url).startswith("Refused")


def test_auto_allow_is_audited_and_never_overrides_a_denial(gateway, store):
    store.update_settings(ALICE, True)
    assert permit(gateway, "https://news.example/") is None
    assert "auto_allowed" in {e["event"] for e in store.audit_log(ALICE)}
    store.request_domain(ALICE, "bad.example")
    store.decide(ALICE, "bad.example", False)
    assert "denied" in permit(gateway, "https://bad.example/")
    assert permit(gateway, "http://127.0.0.1/").startswith("Refused")


def test_approvals_are_per_user(store):
    policy = Policy(store)
    store.request_domain(BOB, "example.com")
    store.decide(BOB, "example.com", True)
    assert policy.access(BOB, "example.com") == "allowed"
    assert policy.access(ALICE, "example.com") == "ask"


# --- stateful tools ---------------------------------------------------------------------------------
def act(gateway, name, **args):
    return gateway.post("/act", json={"name": name, "input": args}).json()["result"]


def test_memory_tools(gateway, store):
    assert act(gateway, "remember", text="My dog is Rex").startswith("Saved memory")
    memory_id = store.memories(ALICE)[0]["id"]
    assert "Rex" in act(gateway, "recall", query="dog")
    assert act(gateway, "forget", id=memory_id) == f"Forgot memory {memory_id}."
    assert act(gateway, "recall", query="dog") == "No memories yet."


def test_schedule_task_tool(gateway, store):
    assert "Scheduled task" in act(gateway, "schedule_task", prompt="check news", every_minutes=60)
    assert store.tasks(ALICE)[0]["prompt"] == "check news"
    assert act(gateway, "schedule_task", prompt="x", every_minutes=0).startswith("Error")


def test_unknown_and_bad_tools_are_answers_not_crashes(gateway, store):
    assert act(gateway, "rm_rf") == "Unknown tool: rm_rf"
    assert act(gateway, "remember", wrong="arg").startswith("Error")
    assert {e["event"] for e in store.audit_log(ALICE)} == {"tool"}


def test_refusal_rules():
    assert refusal("https://example.com/") is None
    assert refusal("ftp://example.com/") and refusal("http://[::1]/") and refusal("http://192.168.1.1/")


# --- the egress proxy, for real --------------------------------------------------------------------
class FakeResolver:
    def __init__(self, ips):
        self.ips = ips

    async def resolve(self, host, port):
        return self.ips[host]


def test_proxy_decisions(store):
    proxy = Proxy(
        store,
        Policy(store, ["ok.com"]),
        platform_hosts=["bedrock-runtime.ap-northeast-1.amazonaws.com"],
        resolver=FakeResolver(
            {
                "ok.com": ["93.184.215.14"],
                "rebind.ok.com": ["169.254.169.254"],
                "bedrock-runtime.ap-northeast-1.amazonaws.com": ["52.119.0.1"],
            }
        ),
    )
    decide = lambda host, port=443: asyncio.run(proxy.decide(ALICE, host, port))
    assert decide("ok.com") == (["93.184.215.14"], None)
    assert decide("bedrock-runtime.ap-northeast-1.amazonaws.com") == (["52.119.0.1"], None)  # no approval needed
    assert "not approved" in decide("evil.com")[1]
    assert "link-local" in decide("rebind.ok.com")[1]  # approved name, internal address: still refused
    assert "not a web port" in decide("ok.com", 22)[1]
    assert {e["event"] for e in store.audit_log(ALICE)} == {"egress_refused"}


def through(proxy_port, url, token=None):
    auth = f"muse:{token}@" if token else ""
    with httpx.Client(proxy=f"http://{auth}127.0.0.1:{proxy_port}", timeout=5) as client:
        return client.get(url)


def test_proxy_needs_the_sandbox_token(proxy_port, web, token):
    r = through(proxy_port, f"http://localhost:{web}/")
    assert r.status_code == 407 and r.headers["proxy-authenticate"].startswith("Basic")
    assert through(proxy_port, f"http://localhost:{web}/", token="u.wrong").status_code == 407


def test_proxy_forwards_approved_and_blocks_the_rest(proxy_port, web, token, store):
    r = through(proxy_port, f"http://localhost:{web}/page", token=token)
    assert r.status_code == 200 and r.text == f"hello from localhost:{web}"
    r = through(proxy_port, f"http://127.0.0.1:{web}/", token=token)
    assert r.status_code == 403 and "not approved" in r.text


def test_proxy_auth_header_parsing():
    from muse.sentinel import _proxy_password

    header = "Proxy-Authorization: Basic " + base64.b64encode(b"muse:abc.def").decode()
    assert _proxy_password(["Host: x", header]) == "abc.def"
    assert _proxy_password(["Proxy-Authorization: Bearer x"]) is None
    assert _proxy_password(["Proxy-Authorization: Basic !!!"]) is None
