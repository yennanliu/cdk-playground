"""API + queue + worker + agent + tools + Postgres, wired as in compose; only the
model, embeddings and browser are fake. The worker is driven inline with run_once()."""

import pytest
from fastapi.testclient import TestClient

from muse.agent import Agent
from muse.api import create_app
from muse.scheduler import Scheduler
from muse.tools import Toolbox
from muse.worker import Worker
from tests.conftest import FakeBrowser, ScriptedLLM, call, say

pytestmark = pytest.mark.postgres


@pytest.fixture
def llm():
    return ScriptedLLM()


@pytest.fixture
def browser():
    return FakeBrowser({"https://example.com/": "Example Domain"})


@pytest.fixture
def worker(store, llm, browser, embedder):
    return Worker(store, Agent(llm, Toolbox(store, browser, embedder), store, embedder))


@pytest.fixture
def client(store, embedder):
    return TestClient(create_app(store, embedder))


def chat(client, worker, message, session="default"):
    job_id = client.post("/chat", json={"message": message, "session": session}).json()["job_id"]
    worker.run_once()
    return client.get(f"/jobs/{job_id}").json()


def test_health_checks_the_database(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_ui(client):
    assert "<title>Muse</title>" in client.get("/").text


class TestChatJobs:
    def test_chat_is_queued_then_answered(self, client, worker, llm):
        r = client.post("/chat", json={"message": "hi"})
        assert r.status_code == 202
        job_id = r.json()["job_id"]
        assert client.get(f"/jobs/{job_id}").json()["status"] == "queued"
        llm.responses += [say("Hello!")]
        worker.run_once()
        job = client.get(f"/jobs/{job_id}").json()
        assert (job["status"], job["result"]) == ("done", "Hello!")

    def test_model_failure_fails_the_job(self, client, store, embedder):
        class Down:
            def converse(self, *a):
                raise RuntimeError("ThrottlingException")

        worker = Worker(store, Agent(Down(), Toolbox(store, FakeBrowser(), embedder), store, embedder))
        job = chat(client, worker, "hi")
        assert job["status"] == "failed" and "ThrottlingException" in job["result"]

    def test_unknown_job_404(self, client):
        assert client.get("/jobs/999").status_code == 404

    def test_empty_message_422(self, client):
        assert client.post("/chat", json={"message": ""}).status_code == 422


class TestMemoryFeature:
    def test_agent_remembers_and_user_sees_it(self, client, worker, llm):
        llm.responses += [call("remember", text="I'm vegetarian"), say("Got it.")]
        chat(client, worker, "I'm vegetarian")
        assert [m["text"] for m in client.get("/memories").json()] == ["I'm vegetarian"]

    def test_relevant_memory_reaches_the_model_in_a_new_session(self, client, worker, llm):
        client.post("/memories", json={"text": "I live in Taipei"})
        llm.responses += [say("Taipei weather...")]
        chat(client, worker, "what is the weather where I live", session="fresh")
        assert "I live in Taipei" in llm.calls[0]["system"]

    def test_forget(self, client):
        mid = client.post("/memories", json={"text": "secret"}).json()["id"]
        assert client.delete(f"/memories/{mid}").status_code == 204
        assert client.delete(f"/memories/{mid}").status_code == 404


class TestApprovalFeature:
    def test_blocked_then_approved_then_browsed(self, client, worker, llm, browser):
        llm.responses += [call("browse", url="https://example.com/"), say("Please approve example.com.")]
        chat(client, worker, "open example.com")
        assert browser.visited == []

        [pending] = client.get("/approvals").json()
        assert (pending["domain"], pending["status"]) == ("example.com", "pending")
        assert client.post(f"/approvals/{pending['id']}", json={"approve": True}).json()["status"] == "approved"

        llm.responses += [call("browse", url="https://example.com/"), say("It says Example Domain.")]
        assert chat(client, worker, "approved, try again")["result"] == "It says Example Domain."
        assert browser.visited == ["https://example.com/"]

    def test_decision_is_audited(self, client, store):
        rid = store.request_domain("example.com")
        client.post(f"/approvals/{rid}", json={"approve": False})
        assert client.get("/audit").json()[0]["event"] == "approval"

    def test_unknown_approval_404(self, client):
        assert client.post("/approvals/42", json={"approve": True}).status_code == 404


class TestBackgroundTaskFeature:
    def test_scheduled_by_agent_run_by_scheduler_and_worker(self, client, store, worker, llm):
        llm.responses += [call("schedule_task", prompt="summarize HN", every_minutes=60), say("Scheduled.")]
        chat(client, worker, "every hour summarize HN")
        assert client.get("/tasks").json()[0]["prompt"] == "summarize HN"

        assert Scheduler(store).tick() == 1
        llm.responses += [say("HN summary: ...")]
        worker.run_once()
        assert client.get("/tasks").json()[0]["last_result"] == "HN summary: ..."

    def test_task_crud_and_validation(self, client):
        tid = client.post("/tasks", json={"prompt": "x", "every_minutes": 5}).json()["id"]
        assert client.delete(f"/tasks/{tid}").status_code == 204
        assert client.delete(f"/tasks/{tid}").status_code == 404
        assert client.post("/tasks", json={"prompt": "x", "every_minutes": 0}).status_code == 422
