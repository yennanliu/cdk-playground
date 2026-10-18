import threading

from muse.scheduler import Scheduler


class FakeAgent:
    def __init__(self, fail=False):
        self.prompts = []
        self.fail = fail

    def run_task(self, prompt):
        self.prompts.append(prompt)
        if self.fail:
            raise RuntimeError("bedrock down")
        return f"done: {prompt}"


def test_tick_runs_due_tasks_and_records_result(store):
    store.add_task("a", every_minutes=10, now=0)
    agent = FakeAgent()
    assert Scheduler(store, agent).tick(now=0) == 1
    assert agent.prompts == ["a"]
    assert store.tasks()[0]["last_result"] == "done: a"


def test_tick_skips_tasks_not_due(store):
    store.add_task("a", every_minutes=10, now=0)
    sched = Scheduler(store, FakeAgent())
    sched.tick(now=0)
    assert sched.tick(now=60) == 0
    assert sched.tick(now=600) == 1


def test_failure_is_recorded_and_task_rescheduled(store):
    store.add_task("a", every_minutes=10, now=0)
    Scheduler(store, FakeAgent(fail=True)).tick(now=0)
    task = store.tasks()[0]
    assert "bedrock down" in task["last_result"]
    assert task["next_run"] == 600
    assert store.audit_log()[0]["event"] == "task_failed"


def test_start_and_stop_background_thread(store):
    ran = threading.Event()

    class Agent:
        def run_task(self, prompt):
            ran.set()
            return "ok"

    store.add_task("a", every_minutes=10)
    sched = Scheduler(store, Agent(), interval=0.01)
    sched.start()
    try:
        assert ran.wait(timeout=2)
    finally:
        sched.stop()
    assert not sched.running
