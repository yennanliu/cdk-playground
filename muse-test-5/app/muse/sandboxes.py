"""The session manager: at most one live sandbox per user, started on demand.

A sandbox counts as alive while it heartbeats, or, just launched, while it may
still be booting. `ensure` starts one when there is none; `Store.replace_sandbox`
is a conditional write, so concurrent callers agree on a single winner. Every
sandbox gets a fresh token, which locks a replaced one out of the sentinel at once.
Sandboxes stop themselves when idle, so there is nothing to reap.
"""

import contextlib
import copy
import logging
import time
from pathlib import Path

import httpx

from muse.store import new_token, token_hash

log = logging.getLogger(__name__)
BOOT_SECONDS = 300  # time to schedule the pod, pull the image on a fresh node and start Python
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


class KubeLauncher:
    """One Kubernetes Job per sandbox, made from the stack's template; the api's service account may create them.

    A Job, not a bare pod: when the sandbox exits, Kubernetes deletes it after `ttlSecondsAfterFinished`.
    """

    SERVICE_ACCOUNT = Path("/var/run/secrets/kubernetes.io/serviceaccount")

    def __init__(self, namespace, job, client=None):
        self.jobs = f"/apis/batch/v1/namespaces/{namespace}/jobs"
        self.job = job
        self.http = client or httpx.Client(
            base_url="https://kubernetes.default.svc",
            verify=str(self.SERVICE_ACCOUNT / "ca.crt"),
            auth=self._bearer,
            timeout=30,
        )

    def _bearer(self, request):
        # Read on every call: the kubelet rotates the projected token.
        request.headers["Authorization"] = f"Bearer {(self.SERVICE_ACCOUNT / 'token').read_text().strip()}"
        return request

    def launch(self, user, token):
        job = copy.deepcopy(self.job)
        labels = {"muse/user": user}  # kubectl -n sandboxes get pods -l muse/user=<sub>
        job["metadata"] = {"generateName": "sandbox-", "labels": labels}
        pod = job["spec"]["template"]
        pod.setdefault("metadata", {}).setdefault("labels", {}).update(labels)
        container = pod["spec"]["containers"][0]
        container["env"] = [*container.get("env", []), {"name": "MUSE_TOKEN", "value": token}]
        r = self.http.post(self.jobs, json=job)
        r.raise_for_status()
        return r.json()["metadata"]["name"]

    def stop(self, task):
        self.http.delete(f"{self.jobs}/{task}", params={"propagationPolicy": "Background"})


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
                # Only the internal sandbox network: the sentinel is all it can reach, as on EKS.
                "HostConfig": {"NetworkMode": self.network, "AutoRemove": True},
            },
        )
        r.raise_for_status()
        container = r.json()["Id"]
        self.http.post(f"/containers/{container}/start").raise_for_status()
        return container

    def stop(self, task):
        self.http.post(f"/containers/{task}/stop")
