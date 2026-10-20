"""The sandbox's real Chromium, through the real sentinel proxy, to a local web server.

uv run playwright install --only-shell chromium && uv run pytest -m browser
"""

import pytest

from muse.sandbox import Browser

pytestmark = pytest.mark.browser


@pytest.fixture
def browser(proxy_port, token):
    browser = Browser(f"http://127.0.0.1:{proxy_port}", token, timeout_ms=10000)
    yield browser
    browser.close()


def test_fetches_an_approved_page_through_the_proxy(browser, web):
    assert browser.fetch(f"http://localhost:{web}/hello") == f"hello from localhost:{web}"


def test_the_proxy_blocks_what_is_not_approved(browser, web):
    page = browser.fetch(f"http://127.0.0.1:{web}/")
    assert page.startswith("HTTP 403") and "Blocked by Muse sentinel" in page


def test_without_the_token_chromium_gets_nowhere(proxy_port, web):
    browser = Browser(f"http://127.0.0.1:{proxy_port}", "dev-x.wrong", timeout_ms=10000)
    try:
        assert "hello" not in browser.fetch(f"http://localhost:{web}/")
    finally:
        browser.close()
