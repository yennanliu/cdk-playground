"""The deployed stack, end to end, as a signed-in user.

../scripts/e2e-test.sh          # creates a throwaway Cognito user, sets MUSE_URL + MUSE_TOKEN, runs this file

Tests run in file order and share one user.
"""

import os
import time

import httpx
import pytest

URL = os.environ.get("MUSE_URL")
TOKEN = os.environ.get("MUSE_TOKEN")

pytestmark = [
    pytest.mark.deployed,
    pytest.mark.skipif(not (URL and TOKEN), reason="set MUSE_URL and MUSE_TOKEN (see scripts/e2e-test.sh)"),
]


@pytest.fixture(scope="module")
def http():
    with httpx.Client(base_url=URL, timeout=30, headers={"Authorization": f"Bearer {TOKEN}"}) as client:
        yield client


def wait_for(check, timeout, every=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if result := check():
            return result
        time.sleep(every)
    pytest.fail(f"timed out after {timeout}s")


def chat(http, message, session="e2e"):
    r = http.post("/chat", json={"message": message, "session": session})
    assert r.status_code == 202, r.text
    turn_id = r.json()["id"]
    turn = wait_for(lambda: (t := http.get(f"/chat/{turn_id}").json())["status"] != "running" and t, timeout=300)
    assert turn["status"] == "done", turn["reply"]
    return turn["reply"]


def test_page_is_public_and_carries_the_cognito_client():
    r = httpx.get(URL + "/")
    assert r.status_code == 200 and "clientId" in r.text and "/*CONFIG*/" not in r.text


def test_api_needs_a_token():
    assert httpx.get(URL + "/tasks").status_code == 401
    assert httpx.get(URL + "/tasks", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_chat_round_trip(http):
    assert "pong" in chat(http, "Reply with exactly the word: pong").lower()


def test_conversation_continues_in_the_same_session(http):
    chat(http, "The secret word for this conversation is 'marmalade'. Just acknowledge it.", session="history")
    assert "marmalade" in chat(http, "What is the secret word?", session="history").lower()


def test_browse_needs_approval_then_works(http):
    reply = chat(http, "Open https://example.com/ and tell me its main heading.")
    approvals = http.get("/approvals").json()
    assert [(a["domain"], a["status"]) for a in approvals] == [("example.com", "pending")], reply

    assert http.post("/approvals/example.com", json={"approve": True}).json()["status"] == "approved"
    assert "example domain" in chat(http, "I approved example.com. Please try again.").lower()


def test_agent_schedules_a_task_through_the_sentinel(http):
    chat(http, "Schedule a background task that runs every 1440 minutes: 'Say good morning.'")
    tasks = http.get("/tasks").json()
    assert [t["every_minutes"] for t in tasks] == [1440]
    assert http.delete(f"/tasks/{tasks[0]['id']}").status_code == 204


def test_scheduled_task_fires_and_reports(http):
    r = http.post("/tasks", json={"prompt": "Reply with exactly the word: tick", "every_minutes": 1})
    assert r.status_code == 201
    task_id = r.json()["id"]
    try:
        task = wait_for(lambda: next((t for t in http.get("/tasks").json() if t.get("last_result")), None), timeout=240)
        assert "tick" in task["last_result"].lower()
    finally:
        assert http.delete(f"/tasks/{task_id}").status_code == 204


def test_long_term_memory_is_extracted_and_can_be_forgotten(http):
    chat(http, "Please remember for the future: my favourite colour is teal.", session="memory")
    # Strategies extract long-term records asynchronously, typically within a minute or two.
    record = wait_for(
        lambda: next((m for m in http.get("/memories").json() if "teal" in m["text"].lower()), None),
        timeout=300,
        every=10,
    )
    assert http.delete(f"/memories/{record['id']}").status_code == 204
    # The record is gone at once (GetMemoryRecord 404s), but listings catch up a little later.
    wait_for(lambda: record["id"] not in [m["id"] for m in http.get("/memories").json()], timeout=120, every=5)


def test_audit_trail_records_actions(http):
    events = {e["event"] for e in http.get("/audit").json()}
    assert {"tool", "turn", "approval", "task_added", "task_deleted"} <= events
