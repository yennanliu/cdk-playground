from tests.conftest import ALICE, BOB


def test_approvals_are_per_user(store):
    store.request_domain(ALICE, "example.com")
    store.decide(ALICE, "example.com", True)
    assert store.approved_domains(ALICE) == {"example.com"}
    assert store.approved_domains(BOB) == set()


def test_request_domain_keeps_an_existing_decision(store):
    store.request_domain(ALICE, "example.com")
    store.decide(ALICE, "example.com", False)
    assert store.request_domain(ALICE, "example.com")["status"] == "denied"
    assert len(store.approvals(ALICE)) == 1


def test_decide_unknown_domain_is_none(store):
    assert store.decide(ALICE, "nope.example", True) is None
    assert store.approvals(ALICE) == []


def test_turn_lifecycle(store):
    turn_id = store.start_turn(ALICE, "default", "hi")
    assert store.turn(ALICE, turn_id)["status"] == "running"
    store.finish_turn(ALICE, turn_id, "hello")
    turn = store.turn(ALICE, turn_id)
    assert (turn["status"], turn["reply"], turn["session"]) == ("done", "hello", "default")
    assert store.turn(BOB, turn_id) is None


def test_tasks(store, clock):
    task_id = store.add_task(ALICE, "check the news", 60)
    clock.now += 5
    store.finish_task(ALICE, task_id, "nothing new")
    task = store.task(ALICE, task_id)
    assert (task["every_minutes"], task["last_result"], task["last_run"]) == (60, "nothing new", clock.now)
    assert store.delete_task(ALICE, task_id)
    assert not store.delete_task(ALICE, task_id)
    assert store.finish_task(ALICE, task_id, "late") is None  # a deleted task is not resurrected


def test_audit_is_newest_first(store, clock):
    for i in range(3):
        clock.now += 1
        store.audit(ALICE, "tool", {"n": i})
    assert [e["detail"]["n"] for e in store.audit_log(ALICE)] == [2, 1, 0]
    assert store.audit_log(BOB) == []


def test_settings_default_off_and_per_user(store):
    assert store.settings(ALICE) == {"auto_allow": False}
    assert store.update_settings(ALICE, True) == {"auto_allow": True}
    assert store.settings(BOB) == {"auto_allow": False}


def test_turns_of_a_session_oldest_first(store, clock):
    for message, session in [("a", "s1"), ("b", "s2"), ("c", "s1")]:
        clock.now += 1
        store.start_turn(ALICE, session, message)
    assert [t["message"] for t in store.turns(ALICE, "s1")] == ["a", "c"]
    assert store.turns(BOB, "s1") == []
