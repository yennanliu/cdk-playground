"""Read a page's text with AgentCore Browser, speaking raw CDP over its automation websocket.

Playwright would do the same in one call, but it ships a 145 MB driver; four CDP
commands keep the Lambda small.
"""

import asyncio
import itertools
import json

from websockets.asyncio.client import connect

TEXT = "document.title + '\\n\\n' + (document.body ? document.body.innerText : '')"


class CDP:
    """Minimal Chrome DevTools Protocol client: send a command, wait for its reply, skip events."""

    def __init__(self, ws):
        self.ws = ws
        self._ids = itertools.count(1)

    async def send(self, method, params=None, session=None):
        msg_id = next(self._ids)
        msg = {"id": msg_id, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        await self.ws.send(json.dumps(msg))
        while True:
            reply = json.loads(await self.ws.recv())
            if reply.get("id") == msg_id:
                if "error" in reply:
                    raise RuntimeError(f"{method}: {reply['error'].get('message')}")
                return reply["result"]

    async def evaluate(self, expression, session):
        result = await self.send("Runtime.evaluate", {"expression": expression, "returnByValue": True}, session)
        return result["result"].get("value")


async def read_page(ws_url, headers, url, timeout=30):
    """Open `url` in a new tab of the browser behind `ws_url` and return its title and text."""
    async with connect(ws_url, additional_headers=headers, max_size=None) as ws:
        cdp = CDP(ws)
        target = await cdp.send("Target.createTarget", {"url": "about:blank"})
        session = (await cdp.send("Target.attachToTarget", {"targetId": target["targetId"], "flatten": True}))[
            "sessionId"
        ]
        try:
            async with asyncio.timeout(timeout):
                nav = await cdp.send("Page.navigate", {"url": url}, session)
                if nav.get("errorText"):
                    raise RuntimeError(f"could not open {url}: {nav['errorText']}")
                while await cdp.evaluate("document.readyState", session) == "loading":
                    await asyncio.sleep(0.25)
            return (await cdp.evaluate(TEXT, session) or "").strip()
        finally:
            await cdp.send("Target.closeTarget", {"targetId": target["targetId"]})


class Browser:
    """A fresh AgentCore Browser session per fetch: nothing carries over between users or pages."""

    def __init__(self, region, max_chars=8000):
        self.region = region
        self.max_chars = max_chars

    def fetch(self, url):
        from bedrock_agentcore.tools.browser_client import browser_session

        with browser_session(self.region) as client:
            ws_url, headers = client.generate_ws_headers()
            text = asyncio.run(read_page(ws_url, headers, url))
        if len(text) > self.max_chars:
            text = text[: self.max_chars] + "\n[truncated]"
        return text
