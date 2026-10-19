import pytest

from muse.worker import Runtime, Worker, runtime_session
from tests.conftest import ALICE, FakeRuntime

ARN = "arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/muse-abc"


def worker(store, client):
    return Worker(store, Runtime(ARN, client))


def test_runtime_session_ids_meet_agentcore_minimum_length():
    assert len(runtime_session(ALICE, "a")) >= 33


def test_turn_invokes_the_runtime_in_the_users_session(store):
    client = FakeRuntime("hello there")
    turn_id = store.start_turn(ALICE, "default", "hi")
    worker(store, client).handle({"turn": {"user": ALICE, "id": turn_id}})

    (call,) = client.calls
    assert call["agentRuntimeArn"] == ARN
    assert call["runtimeSessionId"] == f"{ALICE}-default"
    assert call["payload"] == {"user": ALICE, "session": f"{ALICE}-default", "prompt": "hi", "background": False}
    assert store.turn(ALICE, turn_id)["status"] == "done"
    assert store.turn(ALICE, turn_id)["reply"] == "hello there"


def test_failed_turn_is_recorded(store):
    turn_id = store.start_turn(ALICE, "default", "hi")
    worker(store, FakeRuntime(error=RuntimeError("throttled"))).run_turn(ALICE, turn_id)
    turn = store.turn(ALICE, turn_id)
    assert turn["status"] == "failed" and "throttled" in turn["reply"]


def test_finished_or_unknown_turns_are_not_rerun(store):
    client = FakeRuntime()
    turn_id = store.start_turn(ALICE, "default", "hi")
    store.finish_turn(ALICE, turn_id, "done already")
    worker(store, client).run_turn(ALICE, turn_id)
    worker(store, client).run_turn(ALICE, "missing")
    assert client.calls == []


def test_task_runs_in_background_in_its_own_session(store):
    client = FakeRuntime("3 new headlines")
    task_id = store.add_task(ALICE, "check the news", 60)
    worker(store, client).handle({"task": {"user": ALICE, "id": task_id}})

    (call,) = client.calls
    assert call["payload"]["background"] is True
    assert call["runtimeSessionId"] == f"{ALICE}-task-{task_id}"
    assert store.task(ALICE, task_id)["last_result"] == "3 new headlines"


def test_deleted_task_is_skipped(store):
    client = FakeRuntime()
    assert worker(store, client).run_task(ALICE, "gone") is None
    assert client.calls == []


def test_unknown_event_is_an_error(store):
    with pytest.raises(ValueError):
        worker(store, FakeRuntime()).handle({"what": 1})
