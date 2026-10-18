"""Smoke test against the deployed agent box, reached through an SSM tunnel.

../scripts/e2e-test.sh          # opens the tunnel, sets MUSE_URL, runs this file
"""

import os
import uuid

import httpx
import pytest

URL = os.environ.get("MUSE_URL")

pytestmark = [
    pytest.mark.deployed,
    pytest.mark.skipif(not URL, reason="set MUSE_URL (see scripts/e2e-test.sh)"),
]


@pytest.fixture(scope="module")
def http():
    with httpx.Client(base_url=URL, timeout=120) as c:
        yield c


def test_health(http):
    assert http.get("/health").json() == {"status": "ok"}


def test_ui(http):
    assert "Muse" in http.get("/").text


def test_memory_round_trip(http):
    marker = f"e2e-{uuid.uuid4().hex[:8]}"
    mid = http.post("/memories", json={"text": marker}).json()["id"]
    assert marker in [m["text"] for m in http.get("/memories").json()]
    assert http.delete(f"/memories/{mid}").status_code == 204


def test_chat_reaches_bedrock(http):
    r = http.post("/chat", json={"message": "Reply with exactly the word: pong", "session": "e2e"})
    assert r.status_code == 200, r.text
    assert "pong" in r.json()["reply"].lower()


def test_browse_blocked_until_approved(http):
    # The sentinel must stop an unapproved domain before Chromium ever loads it.
    domain = f"{uuid.uuid4().hex[:8]}.example.org"
    http.post("/chat", json={"message": f"Use the browse tool on https://{domain}/", "session": "e2e"})
    pending = [a for a in http.get("/approvals").json() if a["domain"] == domain]
    assert pending and pending[0]["status"] == "pending"
    http.post(f"/approvals/{pending[0]['id']}", json={"approve": False})


def test_refused_request_still_replies_and_session_survives(http):
    # The model may refuse outright (empty content); the session must stay usable.
    session = f"e2e-{uuid.uuid4().hex[:8]}"
    r = http.post("/chat", json={"message": "Browse http://169.254.169.254/latest/meta-data/", "session": session})
    assert r.status_code == 200 and r.json()["reply"]
    assert http.post("/chat", json={"message": "Say ok", "session": session}).status_code == 200
