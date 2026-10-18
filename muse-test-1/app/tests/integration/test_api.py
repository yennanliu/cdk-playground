"""HTTP API wired to the real agent, toolbox and SQLite store; only the model and browser are fake."""

import pytest
from fastapi.testclient import TestClient

from muse.agent import Agent
from muse.api import create_app
from muse.scheduler import Scheduler
from muse.tools import Toolbox
from tests.conftest import FakeBrowser, ScriptedLLM, call, say


@pytest.fixture
def llm():
    return ScriptedLLM()


@pytest.fixture
def browser():
    return FakeBrowser({"https://example.com/": "Example Domain"})


@pytest.fixture
def agent(store, llm, browser):
    return Agent(llm, Toolbox(store, browser), store)


@pytest.fixture
def client(store, agent):
    return TestClient(create_app(store, agent))


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_ui_is_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Muse" in r.text


def test_chat(client, llm):
    llm.responses += [say("Hi there")]
    assert client.post("/chat", json={"message": "hi"}).json() == {"reply": "Hi there"}


def test_chat_model_failure_is_502(store, browser):
    class Down:
        def converse(self, *a):
            raise RuntimeError("ThrottlingException")

    client = TestClient(create_app(store, Agent(Down(), Toolbox(store, browser), store)))
    r = client.post("/chat", json={"message": "hi"})
    assert r.status_code == 502
    assert "ThrottlingException" in r.json()["detail"]


def test_chat_requires_message(client):
    assert client.post("/chat", json={}).status_code == 422


class TestMemoryFeature:
    def test_agent_remembers_and_user_sees_it(self, client, llm):
        llm.responses += [call("remember", text="I'm vegetarian"), say("Got it.")]
        client.post("/chat", json={"message": "I'm vegetarian"})
        assert [m["text"] for m in client.get("/memories").json()] == ["I'm vegetarian"]

    def test_memory_is_used_in_a_later_session(self, client, llm):
        client.post("/memories", json={"text": "I live in Taipei"})
        llm.responses += [say("Taipei weather...")]
        client.post("/chat", json={"message": "weather?", "session": "new"})
        assert "I live in Taipei" in llm.calls[0]["system"]

    def test_user_can_forget(self, client):
        mid = client.post("/memories", json={"text": "secret"}).json()["id"]
        assert client.delete(f"/memories/{mid}").status_code == 204
        assert client.delete(f"/memories/{mid}").status_code == 404
        assert client.get("/memories").json() == []


class TestSentinelApprovalFeature:
    def test_blocked_then_approved_then_browsed(self, client, llm, browser):
        llm.responses += [call("browse", url="https://example.com/"), say("I need your approval.")]
        client.post("/chat", json={"message": "open example.com"})
        assert browser.visited == []

        [pending] = client.get("/approvals").json()
        assert pending["domain"] == "example.com" and pending["status"] == "pending"
        assert client.post(f"/approvals/{pending['id']}", json={"approve": True}).json()["status"] == "approved"

        llm.responses += [call("browse", url="https://example.com/"), say("It says Example Domain.")]
        reply = client.post("/chat", json={"message": "try again"}).json()["reply"]
        assert reply == "It says Example Domain."
        assert browser.visited == ["https://example.com/"]

    def test_unknown_approval_is_404(self, client):
        assert client.post("/approvals/42", json={"approve": True}).status_code == 404


class TestBackgroundTaskFeature:
    def test_agent_schedules_task_and_scheduler_runs_it(self, client, store, agent, llm):
        llm.responses += [call("schedule_task", prompt="summarize HN", every_minutes=60), say("Scheduled.")]
        client.post("/chat", json={"message": "every hour summarize HN"})
        [task] = client.get("/tasks").json()
        assert task["prompt"] == "summarize HN"

        llm.responses += [say("HN summary: ...")]
        assert Scheduler(store, agent).tick() == 1
        assert client.get("/tasks").json()[0]["last_result"] == "HN summary: ..."

    def test_create_and_delete_task_via_api(self, client):
        tid = client.post("/tasks", json={"prompt": "x", "every_minutes": 5}).json()["id"]
        assert client.delete(f"/tasks/{tid}").status_code == 204
        assert client.delete(f"/tasks/{tid}").status_code == 404

    def test_rejects_non_positive_interval(self, client):
        assert client.post("/tasks", json={"prompt": "x", "every_minutes": 0}).status_code == 422


def test_audit_trail_records_tool_calls(client, llm):
    llm.responses += [call("recall", query="anything"), say("nothing")]
    client.post("/chat", json={"message": "what do you know?"})
    assert client.get("/audit").json()[0]["detail"]["name"] == "recall"
