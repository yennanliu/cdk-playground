"""Browser service: headless Chromium behind an HTTP API, plus the client workers use.

It runs on networks with no route out except the sentinel, and holds no
credentials, so a hostile page can at worst read what Chromium already shows it.
"""

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright
from pydantic import BaseModel


class FetchIn(BaseModel):
    url: str


def create_app(proxy_url=None, max_chars=8000, timeout_ms=20000):
    state = {}

    @asynccontextmanager
    async def lifespan(app):
        async with async_playwright() as p:
            # Playwright sends loopback through the proxy too (`<-loopback>`), unlike plain Chromium.
            state["browser"] = await p.chromium.launch(proxy={"server": proxy_url} if proxy_url else None)
            yield
            await state["browser"].close()

    app = FastAPI(title="Muse browser", lifespan=lifespan)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/fetch")
    async def fetch(body: FetchIn):
        context = await state["browser"].new_context()  # fresh cookies and storage per fetch
        try:
            page = await context.new_page()
            response = await page.goto(body.url, timeout=timeout_ms, wait_until="domcontentloaded")
            text = f"{await page.title()}\n\n{await page.inner_text('body')}".strip()
        except PlaywrightError as e:
            raise HTTPException(502, str(e).splitlines()[0]) from e
        finally:
            await context.close()
        if len(text) > max_chars:
            text = text[:max_chars] + "\n[truncated]"
        return {"status": response.status if response else None, "text": text}

    return app


class BrowserClient:
    def __init__(self, base_url, client=None, timeout=60):
        self.http = client or httpx.Client(base_url=base_url, timeout=timeout)

    def fetch(self, url):
        r = self.http.post("/fetch", json={"url": url})
        if r.status_code != 200:
            raise RuntimeError(r.json().get("detail", r.text))
        page = r.json()
        if page["status"] and page["status"] >= 400:
            return f"HTTP {page['status']}\n\n{page['text']}"
        return page["text"]


def main():
    import uvicorn

    from muse.config import Config

    uvicorn.run(create_app(Config.from_env(os.environ).proxy_url), host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
