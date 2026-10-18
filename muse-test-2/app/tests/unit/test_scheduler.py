import pytest

from muse.scheduler import Scheduler

pytestmark = pytest.mark.postgres


def test_tick_enqueues_due_tasks(store):
    store.add_task("a", every_minutes=10, now=0)
    store.add_task("b", every_minutes=10, now=500)
    assert Scheduler(store).tick(now=100) == 1
    assert store.claim()["input"] == "a"


def test_tick_requeues_jobs_from_dead_workers(store):
    jid = store.enqueue("chat", "x", session="s")
    store.claim(now=0)
    Scheduler(store, stale_after=900).tick(now=901)
    assert store.job(jid)["status"] == "queued"
