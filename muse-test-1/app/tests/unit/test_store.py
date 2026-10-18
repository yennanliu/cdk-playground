from muse.store import Store


class TestMemories:
    def test_remember_and_list(self, store):
        a = store.remember("I am vegetarian")
        b = store.remember("My sister is called Amy")
        assert [m["id"] for m in store.memories()] == [a, b]
        assert store.memories()[0]["text"] == "I am vegetarian"

    def test_recall_matches_any_word_case_insensitive(self, store):
        store.remember("I am vegetarian")
        store.remember("My sister is called Amy")
        assert [m["text"] for m in store.recall("SISTER birthday")] == ["My sister is called Amy"]

    def test_recall_empty_query_returns_everything(self, store):
        store.remember("a")
        store.remember("b")
        assert len(store.recall("")) == 2

    def test_forget(self, store):
        mid = store.remember("temporary")
        assert store.forget(mid) is True
        assert store.forget(mid) is False
        assert store.memories() == []


class TestHistory:
    def test_empty_by_default(self, store):
        assert store.history("s1") == []

    def test_round_trip_per_session(self, store):
        msgs = [{"role": "user", "content": [{"text": "hi"}]}]
        store.save_history("s1", msgs)
        assert store.history("s1") == msgs
        assert store.history("s2") == []

    def test_overwrite(self, store):
        store.save_history("s1", [{"role": "user", "content": [{"text": "1"}]}])
        store.save_history("s1", [])
        assert store.history("s1") == []


class TestTasks:
    def test_new_task_is_due_immediately(self, store):
        tid = store.add_task("check the weather", every_minutes=60, now=1000)
        assert [t["id"] for t in store.due_tasks(now=1000)] == [tid]

    def test_finish_reschedules(self, store):
        tid = store.add_task("check the weather", every_minutes=60, now=1000)
        store.finish_task(tid, "sunny", now=1000)
        assert store.due_tasks(now=1000 + 3599) == []
        assert [t["id"] for t in store.due_tasks(now=1000 + 3600)] == [tid]
        assert store.tasks()[0]["last_result"] == "sunny"

    def test_delete(self, store):
        tid = store.add_task("x", every_minutes=5, now=0)
        assert store.delete_task(tid) is True
        assert store.tasks() == []


class TestDomainApprovals:
    def test_nothing_allowed_by_default(self, store):
        assert store.is_allowed("example.com") is False

    def test_seeded_domain_and_subdomains_allowed(self):
        s = Store(":memory:", allowed_domains=["wikipedia.org"])
        assert s.is_allowed("wikipedia.org")
        assert s.is_allowed("en.wikipedia.org")
        assert not s.is_allowed("evilwikipedia.org")

    def test_request_is_pending_and_deduplicated(self, store):
        a = store.request_domain("example.com")
        b = store.request_domain("example.com")
        assert a == b
        assert [r["status"] for r in store.approvals()] == ["pending"]

    def test_approve_allows_domain(self, store):
        rid = store.request_domain("example.com")
        assert store.decide(rid, approve=True)["status"] == "approved"
        assert store.is_allowed("example.com")

    def test_deny_keeps_domain_blocked(self, store):
        rid = store.request_domain("example.com")
        assert store.decide(rid, approve=False)["status"] == "denied"
        assert not store.is_allowed("example.com")

    def test_decide_unknown_returns_none(self, store):
        assert store.decide(999, approve=True) is None


class TestAudit:
    def test_newest_first(self, store):
        store.audit("tool", {"name": "a"})
        store.audit("tool", {"name": "b"})
        log = store.audit_log()
        assert [e["detail"]["name"] for e in log] == ["b", "a"]
        assert log[0]["event"] == "tool"


def test_persists_to_disk(tmp_path):
    path = tmp_path / "muse.db"
    s = Store(str(path))
    s.remember("durable")
    s.close()
    assert Store(str(path)).memories()[0]["text"] == "durable"
