from playwright.sync_api import sync_playwright


class Browser:
    """Headless Chromium that returns a page's rendered text.

    A fresh browser per fetch: slower than a pool, but Playwright's sync API is
    bound to the thread that started it, and both API threads and the scheduler
    browse.
    """

    def __init__(self, max_chars=8000, timeout_ms=20000):
        self.max_chars = max_chars
        self.timeout_ms = timeout_ms

    def fetch(self, url):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page()
                page.goto(url, timeout=self.timeout_ms, wait_until="domcontentloaded")
                text = f"{page.title()}\n\n{page.inner_text('body')}".strip()
            finally:
                browser.close()
        if len(text) > self.max_chars:
            text = text[: self.max_chars] + "\n[truncated]"
        return text
