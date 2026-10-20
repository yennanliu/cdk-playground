"""The whole local stack (docker compose), with real Bedrock, and proof of the sandbox's isolation.

export AWS_REGION=ap-northeast-1; eval "$(aws configure export-credentials --format env)"
uv run pytest -m compose -v                # ~3 min: builds the image, starts the stack, tears it down

Tests run in file order against one stack.
"""

import base64
import json
import os
import subprocess
import time
from pathlib import Path

import httpx
import pytest

pytestmark = [
    pytest.mark.compose,
    pytest.mark.skipif(not os.environ.get("AWS_REGION"), reason="export AWS_REGION and AWS credentials"),
]

APP = Path(__file__).parents[2]
PORT = 18080
IDLE = 20  # sandboxes sleep after this many idle seconds


def dev_token(sub):
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{part({'alg': 'none'})}.{part({'sub': sub})}."


def compose(*args):
    env = {**os.environ, "MUSE_PORT": str(PORT), "MUSE_IDLE_SECONDS": str(IDLE)}
    return subprocess.run(["docker", "compose", *args], cwd=APP, env=env, check=True, capture_output=True, text=True)


def sandboxes(user=None):
    label = f"muse.sandbox={user}" if user else "muse.sandbox"
    out = subprocess.run(
        ["docker", "ps", "-q", "--filter", f"label={label}"], check=False, capture_output=True, text=True
    )
    return out.stdout.split()


def wait_for(check, timeout, every=1):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if result := check():
            return result
        time.sleep(every)
    pytest.fail(f"timed out after {timeout}s")


@pytest.fixture(scope="module", autouse=True)
def stack():
    compose("up", "-d", "--build", "--wait")
    yield
    compose("down")
    for container in sandboxes():
        subprocess.run(["docker", "rm", "-f", container], check=False, capture_output=True)


def client(user):
    return httpx.Client(
        base_url=f"http://localhost:{PORT}", timeout=30, headers={"Authorization": f"Bearer {dev_token(user)}"}
    )


@pytest.fixture(scope="module")
def jo():
    with client("dev-jo") as http:
        yield http


def chat(http, message):
    r = http.post("/chat", json={"message": message})
    assert r.status_code == 202, r.text
    turn = wait_for(
        lambda: (t := http.get(f"/chat/{r.json()['id']}").json())["status"] not in ("queued", "running") and t,
        timeout=180,
    )
    assert turn["status"] == "done", turn["reply"]
    return turn["reply"]


def test_first_message_starts_a_sandbox_and_gets_a_reply(jo):
    assert sandboxes("dev-jo") == []
    assert "pong" in chat(jo, "Reply with exactly the word: pong").lower()
    assert len(sandboxes("dev-jo")) == 1
    assert jo.get("/sandbox").json()["status"] == "running"


def test_memory_through_the_sentinel(jo):
    chat(jo, "Remember that my favourite city is Kyoto.")
    assert any("Kyoto" in m["text"] for m in jo.get("/memories").json())
    assert "kyoto" in chat(jo, "What is my favourite city? One word.").lower()


def test_browsing_waits_for_approval(jo):
    chat(jo, "What is the main heading on https://example.com/ ?")
    assert {"domain": "example.com", "status": "pending"}.items() <= jo.get("/approvals").json()[0].items()
    jo.post("/approvals/example.com", json={"approve": True})
    assert "example domain" in chat(jo, "I approved it; try again.").lower()


def probe(code):
    """Run Python inside jo's sandbox container."""
    (container,) = sandboxes("dev-jo")
    return subprocess.run(
        ["docker", "exec", "-i", container, "python", "-c", code], check=False, capture_output=True, text=True
    ).stdout.strip()


TCP = """
import socket
try:
    socket.create_connection(({host!r}, {port}), timeout=3).close(); print("open")
except OSError:
    print("blocked")
"""


@pytest.mark.parametrize("host, port", [("example.com", 443), ("1.1.1.1", 443), ("dynamodb", 8000), ("api", 8080)])
def test_sandbox_reaches_nothing_directly(host, port):
    assert probe(TCP.format(host=host, port=port)) == "blocked"


def test_sandbox_reaches_the_sentinel():
    assert probe(TCP.format(host="sentinel", port=3128)) == "open"


PROXY = """
import os, httpx
token = os.environ["MUSE_TOKEN"] if {auth} else "x.y"
r = httpx.get({url!r}, proxy=f"http://muse:{{token}}@sentinel:3128", timeout=10)
print(r.status_code)
"""


@pytest.mark.parametrize(
    "url, auth, status",
    [
        ("http://example.com/", True, "200"),  # approved above
        ("http://example.com/", False, "407"),  # not this sandbox's token
        ("http://wikipedia.org/", True, "403"),  # never approved
        ("http://169.254.169.254/latest/meta-data/", True, "403"),  # metadata
        ("http://dynamodb:8000/", True, "403"),  # internal service by name
    ],
)
def test_sentinel_proxy_rules(url, auth, status):
    assert probe(PROXY.format(url=url, auth=auth)) == status


def test_users_get_separate_sandboxes():
    with client("dev-sam") as sam:
        chat(sam, "Reply with exactly the word: ok")
        assert sam.get("/approvals").json() == []  # jo's approval is jo's
    assert len(sandboxes("dev-sam")) == 1 and sandboxes("dev-sam") != sandboxes("dev-jo")


def test_idle_sandbox_sleeps_and_wakes_on_the_next_message(jo):
    wait_for(lambda: not sandboxes("dev-jo"), timeout=IDLE + 60)
    assert jo.get("/sandbox").json()["status"] == "stopped"
    assert "kyoto" in chat(jo, "What is my favourite city? One word.").lower()  # memory outlives the sandbox
    assert len(sandboxes("dev-jo")) == 1


def test_the_page_signs_in_and_chats():
    from playwright.sync_api import expect, sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f"http://localhost:{PORT}/")
        page.fill("#email", "UI Tester")  # local mode: a name, no password
        page.click("#signin button")
        page.fill("#input", "Reply with exactly the word: pong")
        page.press("#input", "Enter")
        expect(page.locator(".row.muse .bubble").last).to_contain_text("pong", ignore_case=True, timeout=180_000)
        expect(page.locator("#sandbox")).to_have_text("sandbox: awake")
        browser.close()
    assert len(sandboxes("dev-ui-tester")) == 1
