"""The api: web UI, JSON API, session manager and scheduler. It never runs the agent.

Chat is asynchronous. POST /chat queues a turn and makes sure the user's sandbox
is up; the sandbox picks the turn up through the sentinel; the page polls
GET /chat/{id}. The user is always the access token's `sub`; nothing in a request
body can name another user.
"""

import json
import logging
import os
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi import Path as PathParam
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)
UI = Path(__file__).parent / "static" / "index.html"
SESSION = r"^[a-z0-9-]{1,40}$"
PENDING = ("queued", "running")


class ChatIn(BaseModel):
    message: str = Field(min_length=1)
    session: str = Field("default", pattern=SESSION)


class TaskIn(BaseModel):
    prompt: str = Field(min_length=1)
    every_minutes: int = Field(ge=1)


class DecisionIn(BaseModel):
    approve: bool


class SettingsIn(BaseModel):
    auto_allow: bool


def _found(value, what):
    if not value:
        raise HTTPException(404, f"no such {what}")
    return value


def create_app(store, auth, sandboxes, ui_config):
    app = FastAPI(title="Muse")

    def current_user(authorization: str = Header("")):
        try:
            return auth.user(authorization.removeprefix("Bearer "))
        except Exception:  # noqa: BLE001 -- any bad token is a 401
            raise HTTPException(401, "unauthorized") from None

    User = Annotated[str, Depends(current_user)]

    def ensure_sandbox(user):
        try:
            sandboxes.ensure(user)
        except Exception as e:
            log.exception("could not start a sandbox for %s", user)
            raise HTTPException(503, f"Could not start your sandbox: {e}") from e

    @app.get("/", include_in_schema=False)
    def ui():
        return HTMLResponse(UI.read_text().replace("/*CONFIG*/{}", json.dumps(ui_config)))

    @app.get("/health")
    def health():
        return {"status": "ok"}

    # --- chat: queue a turn, then poll it -------------------------------------------
    @app.post("/chat", status_code=202)
    def chat(body: ChatIn, user: User):
        turn_id = store.enqueue_turn(user, body.session, body.message)
        try:
            ensure_sandbox(user)  # after queueing: see Store.stop_sandbox
        except HTTPException:
            # Don't leave it to run unseen later: the user gets the 503 and may well send it again.
            store.cancel_turn(user, turn_id, "Not run: your sandbox could not start.")
            raise
        return {"id": turn_id, "status": "queued"}

    @app.get("/chat")
    def history(user: User, session: Annotated[str, Query(pattern=SESSION)] = "default"):
        keys = ("id", "status", "message", "reply", "created")
        return [{k: t.get(k) for k in keys} for t in store.turns(user, session)]

    @app.get("/chat/{turn_id}")
    def turn(turn_id: str, user: User):
        turn = _found(store.turn(user, turn_id), "turn")
        if turn["status"] in PENDING:
            ensure_sandbox(user)  # someone is waiting: replace a sandbox that died meanwhile
        return {k: turn.get(k) for k in ("id", "session", "status", "message", "reply")}

    @app.get("/sandbox")
    def sandbox(user: User):
        return sandboxes.status(user)

    # --- settings, approvals ---------------------------------------------------------
    @app.get("/settings")
    def get_settings(user: User):
        return store.settings(user)

    @app.put("/settings")
    def put_settings(body: SettingsIn, user: User):
        settings = store.update_settings(user, body.auto_allow)
        store.audit(user, "settings", settings)
        return settings

    @app.get("/approvals")
    def approvals(user: User):
        return sorted(store.approvals(user), key=lambda a: -a["created"])

    @app.post("/approvals/{domain}")
    def decide(domain: Annotated[str, PathParam(pattern=r"^[a-z0-9.-]+$")], body: DecisionIn, user: User):
        decided = _found(store.decide(user, domain, body.approve), "approval")
        store.audit(user, "approval", {"domain": domain, "status": decided["status"]})
        return decided

    # --- memories, tasks, audit --------------------------------------------------------
    @app.get("/memories")
    def memories(user: User):
        return store.memories(user)

    @app.delete("/memories/{memory_id}", status_code=204)
    def forget(memory_id: str, user: User):
        _found(store.forget(user, memory_id), "memory")
        store.audit(user, "memory_forgotten", {"id": memory_id})
        return Response(status_code=204)

    @app.get("/tasks")
    def tasks(user: User):
        return store.tasks(user)

    @app.post("/tasks", status_code=201)
    def add_task(body: TaskIn, user: User):
        task_id = store.add_task(user, body.prompt, body.every_minutes)
        store.audit(user, "task_added", {"id": task_id, "every_minutes": body.every_minutes})
        return {"id": task_id}

    @app.delete("/tasks/{task_id}", status_code=204)
    def delete_task(task_id: str, user: User):
        _found(store.delete_task(user, task_id), "task")
        store.audit(user, "task_deleted", {"id": task_id})
        return Response(status_code=204)

    @app.get("/audit")
    def audit(user: User):
        return store.audit_log(user)

    return app


def launcher_for(config):
    if config.launcher == "docker":
        from muse.sandboxes import DockerLauncher

        # What a local sandbox needs; on EKS the Job template and its IAM role provide these.
        passed = (
            "AWS_REGION",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "MUSE_MODEL_ID",
            "MUSE_IDLE_SECONDS",
        )
        env = {k: v for k in passed if (v := os.environ.get(k))}
        return DockerLauncher(config.sandbox_image, config.sandbox_network, env)

    from muse.sandboxes import KubeLauncher

    return KubeLauncher(config.sandbox_namespace, config.sandbox_job)


def main():
    import uvicorn

    from muse.auth import CognitoAuth, DevAuth
    from muse.config import Config
    from muse.sandboxes import Sandboxes
    from muse.scheduler import Scheduler
    from muse.store import connect

    logging.basicConfig(level=logging.INFO)
    config = Config.from_env(os.environ)
    store = connect(config, create=bool(config.dynamodb_endpoint))  # DynamoDB Local starts empty
    sandboxes = Sandboxes(store, launcher_for(config))
    if config.user_pool_id:
        auth = CognitoAuth(config.region, config.user_pool_id, config.user_pool_client_id)
    elif config.launcher == "docker":
        log.warning("no user pool: trusting unsigned tokens (local runs only)")
        auth = DevAuth()
    else:  # a missing setting must not turn off sign-in
        raise SystemExit("MUSE_USER_POOL_ID is required outside local (MUSE_LAUNCHER=docker) runs")
    Scheduler(store, sandboxes).start()
    ui_config = {"region": config.region, "clientId": config.user_pool_client_id}
    uvicorn.run(create_app(store, auth, sandboxes, ui_config), host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
