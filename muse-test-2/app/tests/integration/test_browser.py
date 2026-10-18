"""Real headless Chromium behind the real sentinel, the way they run in compose."""

import contextlib

import pytest
from fastapi.testclient import TestClient

from muse.browser import BrowserClient, create_app
from tests.integration.servers import sentinel_server, web_server

pytestmark = [pytest.mark.postgres, pytest.mark.browser]


@pytest.fixture
def web():
    with web_server() as port:
        yield f"http://localhost:{port}/"


@contextlib.contextmanager
def browsing(store, allow_private=True, **kwargs):
    """A BrowserClient talking to the browser service, whose Chromium egresses via the sentinel."""
    with sentinel_server(store, allow_private=allow_private) as proxy:
        http = TestClient(create_app(proxy_url=f"http://127.0.0.1:{proxy}", **kwargs))
        try:
            http.__enter__()  # runs the lifespan, which launches Chromium
        except Exception as e:  # noqa: BLE001
            pytest.skip(f"Chromium unavailable: {e}")
        try:
            yield BrowserClient("http://browser", client=http)
        finally:
            http.__exit__(None, None, None)


def approve_localhost(store):
    store.decide(store.request_domain("localhost"), approve=True)


def test_fetch_through_sentinel(store, web):
    approve_localhost(store)
    with browsing(store) as browser:
        text = browser.fetch(web)
    assert "Recipes" in text and "Pancakes" in text and "from js" in text


def test_unapproved_site_never_loads(store, web):
    with browsing(store) as browser:
        text = browser.fetch(web)
    assert text.startswith("HTTP 403") and "Pancakes" not in text


def test_loopback_is_not_exempt_from_the_proxy(store, web):
    # Chromium bypasses proxies for localhost by default; the browser must not.
    approve_localhost(store)
    with browsing(store, allow_private=False) as browser:
        assert browser.fetch(web).startswith("HTTP 403")


def test_long_pages_are_truncated(store, web):
    approve_localhost(store)
    with browsing(store, max_chars=10) as browser:
        assert browser.fetch(web).endswith("[truncated]")


def test_network_errors_raise(store):
    approve_localhost(store)
    with browsing(store) as browser, pytest.raises(RuntimeError, match="ERR_"):
        browser.fetch("http://localhost:1/")
