import threading

import pytest

from muse.worker import Worker

pytestmark = pytest.mark.postgres


class FakeAgent:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def chat(self, session, text):
        self.calls.append(("chat", session, text))
        if self.fail:
            raise RuntimeError("ThrottlingException")
        return f"reply to {text}"

    def run_task(self, prompt):
        self.calls.append(("task", prompt))
        return f"task result for {prompt}"


def test_run_once_on_empty_queue(store):
    assert Worker(store, FakeAgent()).run_once() is False


def test_chat_job(store):
    agent = FakeAgent()
    jid = store.enqueue("chat", "hi", session="s1")
    assert Worker(store, agent).run_once() is True
    assert agent.calls == [("chat", "s1", "hi")]
    assert store.job(jid)["status"] == "done" and store.job(jid)["result"] == "reply to hi"


def test_task_job_updates_task(store):
    store.add_task("weather", every_minutes=60, now=0)
    store.enqueue_due_tasks(now=0)
    Worker(store, FakeAgent()).run_once()
    assert store.tasks()[0]["last_result"] == "task result for weather"


def test_failure_marks_job_failed_and_audits(store):
    jid = store.enqueue("chat", "hi", session="s1")
    Worker(store, FakeAgent(fail=True)).run_once()
    assert store.job(jid)["status"] == "failed"
    assert "ThrottlingException" in store.job(jid)["result"]
    assert store.audit_log()[0]["event"] == "job_failed"


def test_run_forever_picks_up_jobs_and_stops(store, fresh_db):
    from muse.store import Store

    stop = threading.Event()
    worker = Worker(Store(fresh_db), FakeAgent())
    thread = threading.Thread(target=worker.run_forever, args=(stop,), kwargs={"idle_wait": 0.2})
    thread.start()
    try:
        jid = store.enqueue("chat", "ping", session="s")
        for _ in range(50):
            if store.job(jid)["status"] == "done":
                break
            threading.Event().wait(0.1)
        assert store.job(jid)["status"] == "done"
    finally:
        stop.set()
        thread.join(timeout=5)
    assert not thread.is_alive()
