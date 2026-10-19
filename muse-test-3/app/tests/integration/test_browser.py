"""The CDP client against a real headless Chrome in Docker: the same protocol AgentCore Browser speaks.

uv run pytest -m browser
"""

import asyncio
import json
import re
import shutil
import subprocess
import time
import urllib.request
from urllib.parse import quote

import pytest

from muse.browser import read_page

pytestmark = pytest.mark.browser
IMAGE = "chromedp/headless-shell:latest"
PAGE = "<title>Muse test</title><body><h1>Hello</h1><script>document.body.append('from JS')</script></body>"


@pytest.fixture(scope="module")
def chrome():
    """The browser-level CDP websocket URL of a throwaway headless Chrome."""
    if not shutil.which("docker") or subprocess.run(["docker", "info"], check=False, capture_output=True).returncode:
        pytest.skip("needs Docker")
    cid = subprocess.check_output(["docker", "run", "-d", "--rm", "-p", "127.0.0.1::9222", IMAGE], text=True).strip()
    try:
        port = subprocess.check_output(["docker", "port", cid, "9222/tcp"], text=True).split(":")[-1].strip()
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as r:
                    ws_url = json.load(r)["webSocketDebuggerUrl"]
                break
            except OSError:
                time.sleep(0.5)
        else:
            pytest.fail("headless Chrome did not start")
        yield re.sub(r"^ws://[^/]+", f"ws://127.0.0.1:{port}", ws_url)
    finally:
        subprocess.run(["docker", "rm", "-f", cid], check=False, capture_output=True)


def test_reads_rendered_title_and_text(chrome):
    text = asyncio.run(read_page(chrome, {}, "data:text/html," + quote(PAGE)))
    assert text.startswith("Muse test")
    assert "Hello" in text and "from JS" in text  # rendered, not raw HTML


def test_unreachable_page_is_an_error(chrome):
    with pytest.raises(RuntimeError, match="could not open"):
        asyncio.run(read_page(chrome, {}, "http://does-not-exist.invalid/"))


def test_tabs_are_closed_afterwards(chrome):
    asyncio.run(read_page(chrome, {}, "data:text/html,<p>one</p>"))
    port = chrome.split(":")[2].split("/")[0]
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list") as r:
        pages = [t for t in json.load(r) if t["type"] == "page" and t["url"].startswith("data:")]
    assert pages == []
