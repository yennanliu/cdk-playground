from muse.store import new_token, token_hash
from tests.conftest import ALICE, BOB


# --- turns and the queue ---------------------------------------------------------------
def test_turns_are_claimed_oldest_first_and_only_once(store, clock):
    first = store.enqueue_turn(ALICE, "default", "one")
    clock.now += 1
    second = store.enqueue_turn(ALICE, "default", "two")

    assert store.claim_turn(ALICE)["id"] == first
    assert store.claim_turn(ALICE)["id"] == second
    assert store.claim_turn(ALICE) is None
    assert store.turn(ALICE, first)["status"] == "running"


def test_queues_are_per_user(store):
    store.enqueue_turn(ALICE, "default", "mine")
    assert store.claim_turn(BOB) is None
    assert store.has_queued(ALICE) and not store.has_queued(BOB)


def test_finish_and_fail_running(store, clock):
    ids = []
    for message in "abc":
        ids.append(store.enqueue_turn(ALICE, "default", message))
        clock.now += 1
    done, lost, waiting = ids
    store.claim_turn(ALICE), store.claim_turn(ALICE)
    store.finish_turn(ALICE, done, "hi")

    assert store.fail_running(ALICE, "sandbox died") == 1
    assert store.turn(ALICE, lost).items() >= {"status": "failed", "reply": "sandbox died"}.items()
    assert store.turn(ALICE, done)["status"] == "done"
    assert store.turn(ALICE, waiting)["status"] == "queued"  # the next sandbox takes it


def test_turns_lists_one_chat(store, clock):
    store.enqueue_turn(ALICE, "default", "a")
    clock.now += 1
    store.enqueue_turn(ALICE, "other", "b")
    clock.now += 1
    store.enqueue_turn(ALICE, "default", "c")
    assert [t["message"] for t in store.turns(ALICE, "default")] == ["a", "c"]


def test_history_round_trip(store):
    messages = [{"role": "user", "content": [{"text": "hi"}]}]
    store.save_history(ALICE, "default", messages)
    assert store.history(ALICE, "default") == messages
    assert store.history(ALICE, "other") == [] and store.history(BOB, "default") == []


# --- the sandbox record -------------------------------------------------------------------
def test_only_one_caller_wins_a_sandbox(store):
    a, b = token_hash(new_token(ALICE)), token_hash(new_token(ALICE))
    assert store.replace_sandbox(ALICE, None, a)
    assert not store.replace_sandbox(ALICE, None, b)  # lost the race
    assert store.replace_sandbox(ALICE, a, b)  # replaced the one it saw
    assert not store.replace_sandbox(ALICE, a, a)  # stale view


def test_heartbeat_marks_running_until_replaced_or_stopped(store, clock):
    h = token_hash(new_token(ALICE))
    store.replace_sandbox(ALICE, None, h)
    assert store.touch_sandbox(ALICE, h)
    assert store.sandbox(ALICE).items() >= {"status": "running", "seen": clock.now}.items()
    assert not store.touch_sandbox(ALICE, "someone else")
    assert store.stop_sandbox(ALICE, h)
    assert not store.touch_sandbox(ALICE, h)  # signed off: a late heartbeat must not revive it


def test_stop_sandbox_stays_when_work_arrived(store):
    h = token_hash(new_token(ALICE))
    store.replace_sandbox(ALICE, None, h)
    store.enqueue_turn(ALICE, "default", "just in time")
    assert not store.stop_sandbox(ALICE, h)
    assert store.sandbox(ALICE)["status"] == "running"


def test_stop_sandbox_after_replacement_just_goes(store):
    old, new = token_hash(new_token(ALICE)), token_hash(new_token(ALICE))
    store.replace_sandbox(ALICE, None, old)
    store.replace_sandbox(ALICE, old, new)
    store.enqueue_turn(ALICE, "default", "for the new one")
    assert store.stop_sandbox(ALICE, old)
    assert store.sandbox(ALICE)["token_hash"] == new


# --- memories, tasks, approvals --------------------------------------------------------------
def test_recall_ranks_by_meaning(store, embedder):
    for text in ["My dog is called Rex", "I live in Taipei", "My favourite food is ramen"]:
        store.remember(ALICE, text, embedder.embed(text))
    assert store.recall(ALICE, embedder.embed("where do I live"), k=1)[0]["text"] == "I live in Taipei"
    assert store.recall(BOB, embedder.embed("anything")) == []
    assert "embedding" not in store.memories(ALICE)[0]


def test_forget(store, embedder):
    memory_id = store.remember(ALICE, "x", embedder.embed("x"))
    assert not store.forget(BOB, memory_id)
    assert store.forget(ALICE, memory_id)
    assert store.memories(ALICE) == []


def test_due_tasks_advance_once(store, clock):
    task_id = store.add_task(ALICE, "summarise", 60)
    (task,) = store.due_tasks(clock.now)
    assert task["id"] == task_id
    assert store.advance_task(task, clock.now)
    assert not store.advance_task(task, clock.now)  # another scheduler got there first
    assert store.due_tasks(clock.now) == []
    assert len(store.due_tasks(clock.now + 3600)) == 1
    assert store.tasks(ALICE)[0]["next_run"] == clock.now + 3600


def test_deleted_task_is_not_advanced(store, clock):
    store.add_task(ALICE, "x", 5)
    (task,) = store.due_tasks(clock.now)
    store.delete_task(ALICE, task["id"])
    assert not store.advance_task(task, clock.now)


def test_approvals_keep_their_decision(store):
    assert store.request_domain(ALICE, "example.com")["status"] == "pending"
    store.decide(ALICE, "example.com", False)
    assert store.request_domain(ALICE, "example.com")["status"] == "denied"
    assert store.approvals(BOB) == []
    assert store.decide(ALICE, "nope.com", True) is None


def test_audit_newest_first(store, clock):
    store.audit(ALICE, "one", {})
    clock.now += 1
    store.audit(ALICE, "two", {"n": 2})
    assert [e["event"] for e in store.audit_log(ALICE)] == ["two", "one"]
