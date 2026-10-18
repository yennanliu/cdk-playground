"""HTTP API and web UI. Endpoints are sync on purpose: FastAPI runs them in a
thread pool, which is where Playwright's sync API needs to be."""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from muse.agent import Agent
from muse.browser import Browser
from muse.config import Config
from muse.llm import Bedrock
from muse.scheduler import Scheduler
from muse.store import Store
from muse.tools import Toolbox

log = logging.getLogger(__name__)
UI = Path(__file__).parent / "static" / "index.html"


class ChatIn(BaseModel):
    message: str = Field(min_length=1)
    session: str = "default"


class MemoryIn(BaseModel):
    text: str = Field(min_length=1)


class TaskIn(BaseModel):
    prompt: str = Field(min_length=1)
    every_minutes: int = Field(gt=0)


class DecisionIn(BaseModel):
    approve: bool


def _found(ok):
    if not ok:
        raise HTTPException(404)
    return Response(status_code=204)


def create_app(store, agent, scheduler=None):
    @asynccontextmanager
    async def lifespan(app):
        if scheduler:
            scheduler.start()
        yield
        if scheduler:
            scheduler.stop()

    app = FastAPI(title="Muse", lifespan=lifespan)

    @app.get("/", include_in_schema=False)
    def ui():
        return FileResponse(UI)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/chat")
    def chat(body: ChatIn):
        try:
            return {"reply": agent.chat(body.session, body.message)}
        except Exception as e:
            log.exception("chat failed")
            raise HTTPException(502, f"model call failed: {e}")

    @app.get("/memories")
    def memories():
        return store.memories()

    @app.post("/memories", status_code=201)
    def add_memory(body: MemoryIn):
        return {"id": store.remember(body.text)}

    @app.delete("/memories/{memory_id}", status_code=204)
    def forget(memory_id: int):
        return _found(store.forget(memory_id))

    @app.get("/tasks")
    def tasks():
        return store.tasks()

    @app.post("/tasks", status_code=201)
    def add_task(body: TaskIn):
        return {"id": store.add_task(body.prompt, body.every_minutes)}

    @app.delete("/tasks/{task_id}", status_code=204)
    def delete_task(task_id: int):
        return _found(store.delete_task(task_id))

    @app.get("/approvals")
    def approvals():
        return store.approvals()

    @app.post("/approvals/{approval_id}")
    def decide(approval_id: int, body: DecisionIn):
        decided = store.decide(approval_id, body.approve)
        if decided is None:
            raise HTTPException(404)
        store.audit("approval", {"id": approval_id, "domain": decided["domain"], "status": decided["status"]})
        return decided

    @app.get("/audit")
    def audit():
        return store.audit_log()

    return app


def build(config):
    store = Store(config.db_path, allowed_domains=config.allowed_domains)
    agent = Agent(Bedrock(config.model_id, region=config.region), Toolbox(store, Browser()), store)
    return create_app(store, agent, Scheduler(store, agent, interval=config.scheduler_seconds))


def main():
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    # Loopback by default: on EC2 the only way in is an SSM port-forwarding tunnel.
    uvicorn.run(build(Config.from_env(os.environ)), host=os.environ.get("MUSE_HOST", "127.0.0.1"), port=8080)


if __name__ == "__main__":
    main()
