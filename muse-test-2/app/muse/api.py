"""HTTP API and web UI. Chat is asynchronous: POST /chat queues a job for the
workers and returns its id; clients poll GET /jobs/{id}. A chat therefore
survives the client going away, and the API never waits on the model."""

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

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


def _found(value):
    if not value:
        raise HTTPException(404)
    return value


def create_app(store, embedder):
    app = FastAPI(title="Muse")

    @app.get("/", include_in_schema=False)
    def ui():
        return FileResponse(UI)

    @app.get("/health")
    def health():
        return {"status": "ok" if store.ping() else "degraded"}

    @app.post("/chat", status_code=202)
    def chat(body: ChatIn):
        return {"job_id": store.enqueue("chat", body.message, session=body.session)}

    @app.get("/jobs/{job_id}")
    def job(job_id: int):
        return _found(store.job(job_id))

    @app.get("/memories")
    def memories():
        return store.memories()

    @app.post("/memories", status_code=201)
    def add_memory(body: MemoryIn):
        return {"id": store.remember(body.text, embedder.embed(body.text))}

    @app.delete("/memories/{memory_id}", status_code=204)
    def forget(memory_id: int):
        _found(store.forget(memory_id))
        return Response(status_code=204)

    @app.get("/tasks")
    def tasks():
        return store.tasks()

    @app.post("/tasks", status_code=201)
    def add_task(body: TaskIn):
        return {"id": store.add_task(body.prompt, body.every_minutes)}

    @app.delete("/tasks/{task_id}", status_code=204)
    def delete_task(task_id: int):
        _found(store.delete_task(task_id))
        return Response(status_code=204)

    @app.get("/approvals")
    def approvals():
        return store.approvals()

    @app.post("/approvals/{approval_id}")
    def decide(approval_id: int, body: DecisionIn):
        decided = _found(store.decide(approval_id, body.approve))
        store.audit("approval", {"id": approval_id, "domain": decided["domain"], "status": decided["status"]})
        return decided

    @app.get("/audit")
    def audit():
        return store.audit_log()

    return app


def main():
    import uvicorn

    from muse.config import Config
    from muse.llm import Embedder
    from muse.store import Store

    logging.basicConfig(level=logging.INFO)
    config = Config.from_env(os.environ)
    store = Store(config.database_url, allowed_domains=config.allowed_domains)
    app = create_app(store, Embedder(config.embed_model_id, region=config.region))
    # 0.0.0.0 inside the container; compose publishes it on the host's 127.0.0.1 only.
    uvicorn.run(app, host=os.environ.get("MUSE_HOST", "0.0.0.0"), port=8080)


if __name__ == "__main__":
    main()
