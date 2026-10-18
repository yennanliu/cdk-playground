import threading

import pytest

from muse.store import Store

pytestmark = pytest.mark.postgres


class TestMemories:
    def test_remember_and_list(self, store, embedder):
        a = store.remember("I am vegetarian", embedder.embed("I am vegetarian"))
        b = store.remember("My sister is Amy", embedder.embed("My sister is Amy"))
        assert [(m["id"], m["text"]) for m in store.memories()] == [(a, "I am vegetarian"), (b, "My sister is Amy")]

    def test_recall_ranks_by_similarity(self, store, embedder):
        for text in ["I am vegetarian", "My sister is Amy", "I live in Taipei"]:
            store.remember(text, embedder.embed(text))
        found = store.recall(embedder.embed("who is my sister"), k=2)
        assert found[0]["text"] == "My sister is Amy"
        assert len(found) == 2

    def test_forget(self, store, embedder):
        mid = store.remember("temp", embedder.embed("temp"))
        assert store.forget(mid) is True
        assert store.forget(mid) is False


class TestHistory:
    def test_round_trip_per_session(self, store):
        msgs = [{"role": "user", "content": [{"text": "hi"}]}]
        store.save_history("s1", msgs)
        assert store.history("s1") == msgs
        assert store.history("s2") == []


class TestJobQueue:
    def test_enqueue_claim_finish(self, store):
        jid = store.enqueue("chat", "hello", session="s1")
        assert store.job(jid)["status"] == "queued"
        job = store.claim()
        assert (job["id"], job["kind"], job["input"], job["session"]) == (jid, "chat", "hello", "s1")
        assert store.job(jid)["status"] == "running"
        store.finish(jid, "hi!")
        assert store.job(jid)["status"] == "done" and store.job(jid)["result"] == "hi!"

    def test_claim_empty_queue(self, store):
        assert store.claim() is None

    def test_failed_job(self, store):
        jid = store.enqueue("chat", "x", session="s")
        store.claim()
        store.finish(jid, "boom", ok=False)
        assert store.job(jid)["status"] == "failed"

    def test_fifo(self, store):
        a = store.enqueue("chat", "a", session="s")
        b = store.enqueue("chat", "b", session="s")
        assert [store.claim()["id"], store.claim()["id"]] == [a, b]

    def test_concurrent_claims_never_share_a_job(self, fresh_db):
        Store(fresh_db).close()
        seed = Store(fresh_db)
        ids = {seed.enqueue("chat", str(i), session="s") for i in range(20)}
        claimed, lock = [], threading.Lock()

        def drain():
            s = Store(fresh_db)
            while job := s.claim():
                with lock:
                    claimed.append(job["id"])
            s.close()

        threads = [threading.Thread(target=drain) for _ in range(4)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert sorted(claimed) == sorted(ids)

    def test_stale_running_jobs_are_requeued(self, store):
        jid = store.enqueue("chat", "x", session="s")
        store.claim(now=1000)
        assert store.requeue_stale(older_than=999) == 0
        assert store.requeue_stale(older_than=1001) == 1
        assert store.job(jid)["status"] == "queued"

    def test_wait_for_jobs_wakes_on_enqueue(self, fresh_db):
        listener, producer = Store(fresh_db), Store(fresh_db)
        threading.Timer(0.2, lambda: producer.enqueue("chat", "x", session="s")).start()
        assert listener.wait_for_jobs(timeout=5) is True
        assert listener.wait_for_jobs(timeout=0.1) is False


class TestTasks:
    def test_due_tasks_become_jobs_and_reschedule(self, store):
        tid = store.add_task("summarize news", every_minutes=60, now=1000)
        assert store.enqueue_due_tasks(now=1000) == 1
        job = store.claim()
        assert (job["kind"], job["input"], job["task_id"]) == ("task", "summarize news", tid)
        assert store.enqueue_due_tasks(now=1000 + 3599) == 0
        assert store.enqueue_due_tasks(now=1000 + 3600) == 1

    def test_finishing_a_task_job_records_the_result(self, store):
        store.add_task("x", every_minutes=5, now=0)
        store.enqueue_due_tasks(now=0)
        store.finish(store.claim()["id"], "result!")
        assert store.tasks()[0]["last_result"] == "result!"

    def test_delete(self, store):
        tid = store.add_task("x", every_minutes=5)
        assert store.delete_task(tid) is True
        assert store.tasks() == []


class TestApprovals:
    def test_seeded_and_approved_domains(self, fresh_db):
        s = Store(fresh_db, allowed_domains=["wikipedia.org"])
        assert s.is_allowed("en.wikipedia.org")
        assert not s.is_allowed("evilwikipedia.org")
        rid = s.request_domain("Example.com")
        assert s.request_domain("example.com") == rid
        assert s.decide(rid, approve=True)["status"] == "approved"
        assert s.is_allowed("www.example.com")

    def test_deny_and_unknown(self, store):
        rid = store.request_domain("example.com")
        assert store.decide(rid, approve=False)["status"] == "denied"
        assert not store.is_allowed("example.com")
        assert store.decide(999, approve=True) is None


def test_audit_newest_first(store):
    store.audit("tool", {"name": "a"})
    store.audit("egress_blocked", {"host": "b"})
    assert [e["event"] for e in store.audit_log()] == ["egress_blocked", "tool"]


def test_schema_init_is_idempotent_and_concurrent(fresh_db):
    threads = [threading.Thread(target=lambda: Store(fresh_db).close()) for _ in range(5)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert Store(fresh_db).ping()
