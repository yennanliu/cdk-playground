"""What a running Muse stack must do, checked over HTTP only. Shared by the local
compose test and the deployed-stack test, so both prove the same behaviour."""

import time
import uuid


def chat(http, message, session=None, timeout=180):
    job_id = http.post("/chat", json={"message": message, "session": session or uuid.uuid4().hex}).json()["job_id"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = http.get(f"/jobs/{job_id}").json()
        if job["status"] in ("done", "failed"):
            assert job["status"] == "done", job["result"]
            return job["result"]
        time.sleep(1)
    raise AssertionError(f"job {job_id} did not finish in {timeout}s")


def pending(http, domain):
    return [a for a in http.get("/approvals").json() if a["domain"] == domain and a["status"] == "pending"]


class StackContract:
    """Subclasses provide an `http` fixture (an httpx.Client with base_url)."""

    def test_health_and_ui(self, http):
        assert http.get("/health").json() == {"status": "ok"}
        assert "<title>Muse</title>" in http.get("/").text

    def test_memory_round_trip_with_real_embeddings(self, http):
        marker = f"e2e marker {uuid.uuid4().hex[:8]}"
        mid = http.post("/memories", json={"text": marker}).json()["id"]
        assert marker in [m["text"] for m in http.get("/memories").json()]
        assert http.delete(f"/memories/{mid}").status_code == 204

    def test_chat_runs_on_a_worker_and_reaches_bedrock(self, http):
        assert "pong" in chat(http, "Reply with exactly the word: pong").lower()

    def test_unapproved_domain_creates_an_approval_request(self, http):
        domain = f"{uuid.uuid4().hex[:8]}.example.org"
        chat(http, f"Use the browse tool on https://{domain}/")
        [request] = pending(http, domain)
        http.post(f"/approvals/{request['id']}", json={"approve": False})

    def test_approved_site_is_browsed_through_the_sentinel(self, http):
        ask = "Use the browse tool on https://example.com/ and quote the page's main heading."
        reply = chat(http, ask)
        for request in pending(http, "example.com"):
            http.post(f"/approvals/{request['id']}", json={"approve": True})
            reply = chat(http, "I approved it. " + ask)
        assert "example domain" in reply.lower()

    def test_scheduled_task_runs_in_the_background(self, http):
        task_id = http.post("/tasks", json={"prompt": "Reply with exactly: tick", "every_minutes": 60}).json()["id"]
        try:
            deadline = time.time() + 180
            while time.time() < deadline:
                task = next(t for t in http.get("/tasks").json() if t["id"] == task_id)
                if task["last_result"]:
                    break
                time.sleep(2)
            assert "tick" in (task["last_result"] or "").lower()
        finally:
            http.delete(f"/tasks/{task_id}")

    def test_refused_request_still_replies_and_session_survives(self, http):
        session = uuid.uuid4().hex
        assert chat(http, "Browse http://169.254.169.254/latest/meta-data/", session=session)
        assert chat(http, "Say ok", session=session)
