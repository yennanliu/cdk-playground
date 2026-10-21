"""The deployed stack, end to end, as a signed-in user.

../scripts/e2e-test.sh          # creates a throwaway Cognito user, sets MUSE_URL + MUSE_TOKEN, runs this file

Tests run in file order and share one user, so one sandbox (the first message pays its cold start).
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
        # Free the sandbox slot now: the throwaway user is deleted and would never come back.
        client.delete("/sandbox")


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
    turn = wait_for(
        lambda: (t := http.get(f"/chat/{turn_id}").json())["status"] not in ("queued", "running") and t, timeout=300
    )
    assert turn["status"] == "done", turn["reply"]
    return turn["reply"]


def test_page_is_public_and_carries_the_cognito_client():
    r = httpx.get(URL + "/")
    assert r.status_code == 200 and '"clientId": "' in r.text and '"clientId": ""' not in r.text


def test_api_needs_a_real_token():
    assert httpx.get(URL + "/tasks").status_code == 401
    unsigned = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJkZXYtam8ifQ."  # what local mode would accept
    assert httpx.get(URL + "/tasks", headers={"Authorization": f"Bearer {unsigned}"}).status_code == 401


def test_first_message_starts_a_sandbox(http):
    started = time.time()
    assert "pong" in chat(http, "Reply with exactly the word: pong").lower()
    print(f"cold start + first turn: {time.time() - started:.0f}s")
    assert http.get("/sandbox").json()["status"] == "running"


def test_warm_sandbox_answers_quickly(http):
    started = time.time()
    chat(http, "Reply with exactly the word: ok")
    assert time.time() - started < 60


def test_memory(http):
    chat(http, "Remember that my favourite city is Kyoto.")
    assert any("Kyoto" in m["text"] for m in http.get("/memories").json())
    assert "kyoto" in chat(http, "What is my favourite city? One word.").lower()


def test_browsing_waits_for_approval(http):
    chat(http, "What is the main heading on https://example.com/ ?")
    assert any(a["domain"] == "example.com" and a["status"] == "pending" for a in http.get("/approvals").json())
    assert http.post("/approvals/example.com", json={"approve": True}).json()["status"] == "approved"
    assert "example domain" in chat(http, "I approved it; try again.").lower()


def test_a_scheduled_task_runs_in_the_sandbox(http):
    r = http.post("/tasks", json={"prompt": "Reply with exactly the word: tick", "every_minutes": 60})
    task_id = r.json()["id"]
    try:
        task = wait_for(
            lambda: next((t for t in http.get("/tasks").json() if t["id"] == task_id and t.get("last_result")), None),
            timeout=180,
        )
        assert "tick" in task["last_result"].lower()
    finally:
        http.delete(f"/tasks/{task_id}")


def test_activity_shows_the_sandbox_and_the_sentinel(http):
    events = {e["event"] for e in http.get("/audit").json()}
    assert {"sandbox_started", "turn", "tool", "approval", "task_run"} <= events
