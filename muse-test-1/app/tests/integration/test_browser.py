"""Real headless Chromium against a local web server."""

import http.server
import threading

import pytest

from muse.browser import Browser
from muse.tools import Toolbox

pytestmark = pytest.mark.browser

PAGE = (
    b"<html><head><title>Recipes</title><script>document.write('<p>from js</p>')</script></head>"
    b"<body><h1>Pancakes</h1><p>Flour, eggs, milk.</p></body></html>"
)


@pytest.fixture(scope="module")
def site():
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/"
    server.shutdown()


@pytest.fixture(scope="module")
def browser():
    b = Browser()
    try:
        b.fetch("about:blank")
    except Exception as e:  # noqa: BLE001 -- Chromium not installed
        pytest.skip(f"Chromium unavailable: {e}")
    return b


def test_fetch_returns_title_and_rendered_text(browser, site):
    text = browser.fetch(site)
    assert "Recipes" in text
    assert "Pancakes" in text
    assert "from js" in text  # JavaScript ran


def test_fetch_truncates_long_pages(site):
    text = Browser(max_chars=10).fetch(site)
    assert len(text) <= 10 + len("\n[truncated]")
    assert text.endswith("[truncated]")


def test_private_addresses_refused_by_default(store, browser, site):
    out = Toolbox(store, browser).run("browse", {"url": site})
    assert out.startswith("Refused")


def test_toolbox_browses_after_approval(store, browser, site):
    toolbox = Toolbox(store, browser, allow_private=True)
    assert "approval" in toolbox.run("browse", {"url": site}).lower()
    store.decide(store.approvals()[0]["id"], approve=True)
    assert "Pancakes" in toolbox.run("browse", {"url": site})
