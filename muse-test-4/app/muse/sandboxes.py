"""The session manager: at most one live sandbox per user, started on demand.

A sandbox counts as alive while it heartbeats, or, just launched, while it may
still be booting. `ensure` starts one when there is none; `Store.replace_sandbox`
is a conditional write, so concurrent callers agree on a single winner. Every
sandbox gets a fresh token, which locks a replaced one out of the sentinel at once.
Sandboxes stop themselves when idle, so there is nothing to reap.
"""

import contextlib
import logging
import time

import httpx

from muse.store import new_token, token_hash

log = logging.getLogger(__name__)
BOOT_SECONDS = 300  # Fargate pulls the image and starts Chromium's Python on every launch
HEARTBEAT_SECONDS = 60


class Sandboxes:
    def __init__(self, store, launcher, clock=time.time):
        self.store = store
        self.launcher = launcher
        self.clock = clock

    def state(self, box):
        """ "stopped", "starting", "running", or "lost" (stopped heartbeating)."""
        if not box or box["status"] == "stopped":
            return "stopped"
        last, limit = (box["seen"], HEARTBEAT_SECONDS) if "seen" in box else (box["started"], BOOT_SECONDS)
        return box["status"] if self.clock() - last < limit else "lost"

    def status(self, user):
        box = self.store.sandbox(user)
        return {"status": self.state(box), **{k: box[k] for k in ("started", "seen") if box and k in box}}

    def ensure(self, user):
        """Make sure the user has a live sandbox; start one if not."""
        box = self.store.sandbox(user)
        if self.state(box) in ("starting", "running"):
            return
        token = new_token(user)
        if not self.store.replace_sandbox(user, box and box["token_hash"], token_hash(token)):
            return  # another request started one just now
        if box and box["status"] != "stopped":
            self.store.fail_running(user, "The sandbox stopped before finishing this. Please try again.")
            with contextlib.suppress(Exception):
                self.launcher.stop(box.get("task"))
        try:
            task = self.launcher.launch(user, token)
        except Exception:
            self.store.update_sandbox(user, token_hash(token), status="stopped")
            raise
        self.store.update_sandbox(user, token_hash(token), task=task)
        self.store.audit(user, "sandbox_started", {"task": task})


class EcsLauncher:
    """One Fargate task per sandbox, in the isolated subnets."""

    def __init__(self, ecs, cluster, task_definition, subnets, security_groups, container="sandbox"):
        self.ecs = ecs
        self.cluster = cluster
        self.task_definition = task_definition
        self.network = {
            "awsvpcConfiguration": {"subnets": subnets, "securityGroups": security_groups, "assignPublicIp": "DISABLED"}
        }
        self.container = container

    def launch(self, user, token):
        response = self.ecs.run_task(
            cluster=self.cluster,
            taskDefinition=self.task_definition,
            launchType="FARGATE",
            networkConfiguration=self.network,
            overrides={
                "containerOverrides": [
                    {"name": self.container, "environment": [{"name": "MUSE_TOKEN", "value": token}]}
                ]
            },
            startedBy=f"muse:{user}"[:128],  # aws ecs list-tasks --started-by muse:<sub>
        )
        if response["failures"] or not response["tasks"]:
            raise RuntimeError(f"RunTask failed: {response['failures']}")
        return response["tasks"][0]["taskArn"]

    def stop(self, task):
        self.ecs.stop_task(cluster=self.cluster, task=task, reason="replaced by a new sandbox")


class DockerLauncher:
    """Local runs: one container per sandbox, through the Docker Engine API on the mounted socket."""

    def __init__(self, image, network, env, client=None):
        self.image = image
        self.network = network
        self.env = env
        self.http = client or httpx.Client(
            base_url="http://docker/v1.43", transport=httpx.HTTPTransport(uds="/var/run/docker.sock"), timeout=30
        )

    def launch(self, user, token):
        env = {**self.env, "MUSE_TOKEN": token}
        r = self.http.post(
            "/containers/create",
            json={
                "Image": self.image,
                "Cmd": ["python", "-m", "muse.sandbox"],
                "Env": [f"{k}={v}" for k, v in env.items()],
                "Labels": {"muse.sandbox": user},
                # Only the internal sandbox network: the sentinel is all it can reach, as on Fargate.
                "HostConfig": {"NetworkMode": self.network, "AutoRemove": True},
            },
        )
        r.raise_for_status()
        container = r.json()["Id"]
        self.http.post(f"/containers/{container}/start").raise_for_status()
        return container

    def stop(self, task):
        self.http.post(f"/containers/{task}/stop")
