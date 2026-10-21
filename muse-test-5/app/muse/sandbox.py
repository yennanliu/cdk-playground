"""A user's sandbox: one pod per active user, under gVisor (its own user-space kernel).

It runs the agent and a headless Chromium, and holds nothing worth stealing: no
table access, and a role that can only call the model. A NetworkPolicy lets it
reach the sentinel and cluster DNS, nothing else. It pulls its user's turns
from the sentinel, and stops itself after `idle_seconds` with nothing to do;
the api starts a new one when the user next needs it.
"""

import logging
import os
import threading
import time
from urllib.parse import quote, urlsplit

import httpx

log = logging.getLogger(__name__)
HEARTBEAT_SECONDS = 15


class Gateway:
    """The sentinel's gateway, as this sandbox's user."""

    def __init__(self, url, token, client=None):
        self.http = client or httpx.Client(base_url=url, headers={"Authorization": f"Bearer {token}"}, timeout=60)

    def _post(self, path, body=None):
        r = self.http.post(path, json=body or {})
        r.raise_for_status()
        return r

    def next_turn(self):
        r = self._post("/next")
        return r.json() if r.status_code == 200 else None

    def finish(self, turn_id, reply, ok, messages):
        self._post(f"/turns/{turn_id}", {"reply": reply, "ok": ok, "messages": messages})

    def heartbeat(self):
        self._post("/heartbeat")

    def sign_off(self):
        """True if this sandbox may stop now."""
        return self._post("/bye").json()["stopped"]

    def permit(self, url):
        """None if the URL may be browsed, else why not."""
        return self._post("/permit", {"url": url}).json()["reason"]

    def act(self, name, args):
        return self._post("/act", {"name": name, "input": args}).json()["result"]


class Browser:
    """Headless Chromium whose only way out is the sentinel proxy. Started on first use."""

    def __init__(self, proxy_url, token, max_chars=8000, timeout_ms=20000):
        self.proxy = {"server": proxy_url, "username": "muse", "password": token}
        self.max_chars = max_chars
        self.timeout_ms = timeout_ms
        self._playwright = self._browser = None

    def fetch(self, url):
        from playwright.sync_api import Error as PlaywrightError

        if self._browser is None:
            from playwright.sync_api import sync_playwright

            self._playwright = sync_playwright().start()
            # A pod's /dev/shm is 64 MB; Chromium falls back to /tmp.
            self._browser = self._playwright.chromium.launch(proxy=self.proxy, args=["--disable-dev-shm-usage"])
        context = self._browser.new_context()  # fresh cookies and storage per page
        try:
            page = context.new_page()
            response = page.goto(url, timeout=self.timeout_ms, wait_until="domcontentloaded")
            text = f"{page.title()}\n\n{page.inner_text('body')}".strip()
        except PlaywrightError as e:
            return f"Error: {str(e).splitlines()[0]}"
        finally:
            context.close()
        if len(text) > self.max_chars:
            text = text[: self.max_chars] + "\n[truncated]"
        if response and response.status >= 400:
            return f"HTTP {response.status}\n\n{text}"
        return text

    def close(self):
        if self._browser is not None:
            self._browser.close()
            self._playwright.stop()
            self._browser = None


class Runner:
    def __init__(self, gateway, agent, idle_seconds, clock=time.monotonic):
        self.gateway = gateway
        self.agent = agent
        self.idle_seconds = idle_seconds
        self.clock = clock

    def run(self):
        idle_since = self.clock()
        while True:
            if turn := self.gateway.next_turn():
                self.serve(turn)
                idle_since = self.clock()
            elif self.clock() - idle_since >= self.idle_seconds and self.gateway.sign_off():
                log.info("idle for %ds; stopping", self.idle_seconds)
                return

    def serve(self, turn):
        try:
            reply, messages = self.agent.run(turn)
            ok = True
        except Exception as e:  # recorded on the turn so the user sees it
            log.exception("turn %s failed", turn["id"])
            reply, messages, ok = f"The agent failed: {e}", None, False
        self.gateway.finish(turn["id"], reply, ok, messages)


def with_credentials(proxy_url, token):
    """http://sentinel:3128 -> http://muse:<token>@sentinel:3128, for clients that take a proxy URL."""
    parts = urlsplit(proxy_url)
    return parts._replace(netloc=f"muse:{quote(token, safe='')}@{parts.netloc}").geturl()


def _heartbeat(gateway):
    while True:
        try:
            gateway.heartbeat()
        except httpx.HTTPError as e:  # a replaced sandbox finds out on its next request too
            log.warning("heartbeat failed: %s", e)
        time.sleep(HEARTBEAT_SECONDS)


def main():
    from muse.agent import Agent, Toolbox
    from muse.config import Config
    from muse.llm import Bedrock

    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # a line per sentinel request otherwise
    config = Config.from_env(os.environ)
    # Every AWS call goes through the sentinel: the model, and STS for this pod's IAM role (IRSA).
    os.environ["HTTPS_PROXY"] = with_credentials(config.proxy_url, config.token)
    gateway = Gateway(config.gateway_url, config.token)
    llm = Bedrock(config.model_id, region=config.region)
    agent = Agent(llm, Toolbox(gateway, Browser(config.proxy_url, config.token)))

    threading.Thread(target=_heartbeat, args=(gateway,), daemon=True).start()
    log.info("sandbox ready")
    Runner(gateway, agent, config.idle_seconds).run()


if __name__ == "__main__":
    main()
