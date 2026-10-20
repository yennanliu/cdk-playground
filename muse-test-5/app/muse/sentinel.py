"""The sentinel: the sandboxes' only way out, and the only way they act.

One process, two listeners, both authenticated by the sandbox's token
(`<user>.<secret>`, valid only while it is that user's current sandbox):

  :8081  gateway  hands a sandbox its user's turns and takes the results; runs the
                  stateful tools (memories, tasks); decides whether a URL may be browsed.
  :3128  proxy    the only route to the internet, for the browser and the AWS clients
                  alike: the model and STS endpoints, or domains this user approved; web ports
                  only; public addresses only, connecting to the exact IP it checked.

Sandboxes have no other route out and no access to the table, so these rules
hold even if the agent or a page it loads is compromised. The user every
decision is made for comes from the token, never from the model.
"""

import asyncio
import base64
import contextlib
import hmac
import ipaddress
import logging
import os
import socket
from http import HTTPStatus
from typing import Annotated, Any
from urllib.parse import urlparse, urlsplit

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel

from muse.store import token_hash

log = logging.getLogger(__name__)
WEB_PORTS = {80, 443}
POLL_SECONDS = 20


# --- policy -------------------------------------------------------------------------
def refusal(url):
    """Why a URL is never browsed, approval or not; None if it may be."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return "only http(s) URLs can be browsed"
    try:
        ip = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        ip = None
    if parsed.hostname == "localhost" or (ip and (ip.is_private or ip.is_loopback or ip.is_link_local)):
        return "private, loopback and link-local addresses are never browsed"
    return None


def ip_refusal(ip, allow_private=False):
    """Why an address must never be connected to, or None."""
    addr = ipaddress.ip_address(ip)
    if addr.is_link_local:  # instance and task metadata: would leak AWS credentials
        return f"{ip} is link-local"
    if not allow_private and (
        addr.is_private or addr.is_loopback or addr.is_unspecified or addr.is_reserved or addr.is_multicast
    ):
        return f"{ip} is not a public address"
    return None


def domain_allowed(host, allowed):
    return any(host == d or host.endswith("." + d) for d in allowed)


class Policy:
    def __init__(self, store, allowed_domains=()):
        self.store = store
        self.seeded = {d.lower() for d in allowed_domains}

    def access(self, user, host):
        """ "allowed", "auto" (only because auto-allow is on), "denied", or "ask"."""
        host = host.lower()
        approvals = {a["domain"]: a["status"] for a in self.store.approvals(user)}
        if domain_allowed(host, self.seeded | {d for d, s in approvals.items() if s == "approved"}):
            return "allowed"
        if approvals.get(host) == "denied":
            return "denied"  # auto-allow skips the question; it never overrides a "no"
        return "auto" if self.store.settings(user)["auto_allow"] else "ask"


def sandbox_user(store, token):
    """The user whose *current* sandbox holds this token, or None."""
    user, _, secret = (token or "").rpartition(".")
    if not user or not secret:
        return None
    box = store.sandbox(user)
    if not box or not hmac.compare_digest(box["token_hash"], token_hash(token)):
        return None
    return user


# --- gateway --------------------------------------------------------------------------
class UrlIn(BaseModel):
    url: str


class ActIn(BaseModel):
    name: str
    input: dict[str, Any]


class ResultIn(BaseModel):
    reply: str
    ok: bool = True
    messages: list | None = None  # None: keep none of this turn in the chat's history


class Actions:
    """The stateful tools, run here so the sandbox never touches the table."""

    def __init__(self, store, embedder):
        self.store = store
        self.embedder = embedder

    def run(self, user, name, args):
        self.store.audit(user, "tool", {"name": name, "input": args})
        handler = {
            "remember": self._remember,
            "recall": self._recall,
            "forget": self._forget,
            "schedule_task": self._schedule_task,
        }.get(name)
        if not handler:
            return f"Unknown tool: {name}"
        try:
            return handler(user, **args)
        except Exception as e:  # noqa: BLE001 -- a failed tool is information for the model, not a crash
            return f"Error: {e}"

    def _remember(self, user, text):
        return f"Saved memory {self.store.remember(user, text, self.embedder.embed(text))}."

    def _recall(self, user, query):
        found = self.store.recall(user, self.embedder.embed(query))
        return "\n".join(f"{m['id']}: {m['text']}" for m in found) or "No memories yet."

    def _forget(self, user, id):
        return f"Forgot memory {id}." if self.store.forget(user, id) else f"No memory {id}."

    def _schedule_task(self, user, prompt, every_minutes):
        if int(every_minutes) < 1:
            raise ValueError("every_minutes must be at least 1")
        task_id = self.store.add_task(user, prompt, int(every_minutes))
        return f"Scheduled task {task_id} every {every_minutes} minutes; its first run starts shortly."


def create_gateway(store, policy, embedder, poll_seconds=POLL_SECONDS, tick=1.0):
    app = FastAPI(title="Muse sentinel")
    actions = Actions(store, embedder)

    def caller(authorization: str = Header("")):
        token = authorization.removeprefix("Bearer ")
        if not (user := sandbox_user(store, token)):
            raise HTTPException(401, "not the user's current sandbox")
        return user, token_hash(token)

    Caller = Annotated[tuple[str, str], Depends(caller)]

    def payload(user, turn):
        task = turn.get("task_id")
        return {
            "id": turn["id"],
            "kind": "task" if task else "chat",
            "prompt": turn["message"],
            "history": [] if task else store.history(user, turn["session"]),
            "memories": [
                {"id": m["id"], "text": m["text"]} for m in store.recall(user, embedder.embed(turn["message"]))
            ],
        }

    @app.post("/next")
    async def next_turn(who: Caller):
        """Long poll: this user's next turn, or 204 after `poll_seconds`."""
        user, _ = who
        for _ in range(int(poll_seconds / tick)):
            if turn := await asyncio.to_thread(store.claim_turn, user):
                return await asyncio.to_thread(payload, user, turn)
            await asyncio.sleep(tick)
        return Response(status_code=204)

    @app.post("/turns/{turn_id}", status_code=204)
    def finish(turn_id: str, body: ResultIn, who: Caller):
        user, _ = who
        turn = store.turn(user, turn_id)
        if not turn or turn["status"] != "running":
            raise HTTPException(409, "not a running turn")
        if task_id := turn.get("task_id"):
            store.finish_task(user, task_id, body.reply)
        elif body.messages is not None:
            store.save_history(user, turn["session"], body.messages)
        store.finish_turn(user, turn_id, body.reply, body.ok)
        store.audit(user, "task_run" if task_id else "turn", {"id": turn_id, "ok": body.ok})

    @app.post("/heartbeat", status_code=204)
    def heartbeat(who: Caller):
        if not store.touch_sandbox(*who):
            raise HTTPException(409, "this sandbox has signed off")

    @app.post("/bye")
    def bye(who: Caller):
        """An idle sandbox asks to stop; `stopped: false` means work arrived and it must stay."""
        stopped = store.stop_sandbox(*who)
        if stopped:
            store.audit(who[0], "sandbox_stopped", {})
        return {"stopped": stopped}

    @app.post("/permit")
    def permit(body: UrlIn, who: Caller):
        """May the sandbox browse this URL? `reason` is None if so, else what to tell the model."""
        user, _ = who
        store.audit(user, "tool", {"name": "browse", "input": {"url": body.url}})
        if reason := refusal(body.url):
            store.audit(user, "refused", {"url": body.url, "reason": reason})
            return {"reason": f"Refused: {reason}"}
        host = urlparse(body.url).hostname.lower()
        match policy.access(user, host):
            case "allowed":
                return {"reason": None}
            case "auto":
                store.audit(user, "auto_allowed", {"domain": host, "url": body.url})
                return {"reason": None}
            case "denied":
                return {"reason": f"Blocked: the user denied access to {host}. Do not try again."}
        store.request_domain(user, host)
        return {
            "reason": f"Blocked: {host} is not approved yet. An approval request was sent to the user; "
            "ask them to approve it, then try again."
        }

    @app.post("/act")
    def act(body: ActIn, who: Caller):
        return {"result": actions.run(who[0], body.name, body.input)}

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


# --- egress proxy -----------------------------------------------------------------------
class DnsResolver:
    async def resolve(self, host, port):
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
        return list(dict.fromkeys(info[4][0] for info in infos))


class Proxy:
    """An HTTP forward proxy (CONNECT for https, absolute-URI requests for http)."""

    def __init__(self, store, policy, platform_hosts=(), allow_private=False, resolver=None):
        self.store = store
        self.policy = policy
        # Reachable by any sandbox without approval: the model endpoint, and STS for its IAM role.
        self.platform_hosts = {h.lower() for h in platform_hosts}
        self.allow_private = allow_private
        self.resolver = resolver or DnsResolver()

    async def decide(self, user, host, port):
        """Returns (the checked IPs to connect to, None) or (None, why not)."""
        if port not in WEB_PORTS and not self.allow_private:
            return await self._refuse(user, host, port, f"port {port} is not a web port")
        platform = host.lower() in self.platform_hosts
        if not platform and await asyncio.to_thread(self.policy.access, user, host) not in ("allowed", "auto"):
            # Not audited: a page's third-party requests would flood the trail.
            return None, f"{host} is not approved; ask Muse to browse it to request approval"
        try:
            ips = await self.resolver.resolve(host, port)
        except OSError as e:
            return None, f"{host} does not resolve ({e})"
        for ip in ips:
            if reason := ip_refusal(ip, self.allow_private):
                return await self._refuse(user, host, port, f"resolves to {reason}")
        return ips, None

    async def _refuse(self, user, host, port, reason):
        await asyncio.to_thread(
            self.store.audit, user, "egress_refused", {"host": host, "port": port, "reason": reason}
        )
        return None, f"{host}:{port} {reason}"

    async def handle(self, reader, writer):
        try:
            await self._handle(reader, writer)
        except Exception:  # one bad connection must never take the proxy down
            log.exception("proxy connection failed")
        finally:
            with contextlib.suppress(Exception):
                writer.close()

    async def _handle(self, reader, writer):
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 30)
            request_line, *headers = head.decode("latin-1").split("\r\n")
            method, target, version = request_line.split(" ")
            if method == "CONNECT":
                host, _, port = target.rpartition(":")
                host, port, url = host.strip("[]"), int(port), None
            else:
                url = urlsplit(target)
                if url.scheme != "http" or not url.hostname:
                    raise ValueError(target)
                host, port = url.hostname, url.port or 80
        except (ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError):
            return await _respond(writer, HTTPStatus.BAD_REQUEST, "not a proxy request")

        user = await asyncio.to_thread(sandbox_user, self.store, _proxy_password(headers))
        if not user:
            return await _respond(
                writer,
                HTTPStatus.PROXY_AUTHENTICATION_REQUIRED,
                "sandbox token required",
                'Proxy-Authenticate: Basic realm="muse"\r\n',
            )
        ips, reason = await self.decide(user, host, port)
        if reason:
            return await _respond(writer, HTTPStatus.FORBIDDEN, f"Blocked by Muse sentinel: {reason}")

        upstream_reader, upstream_writer = await _connect(ips, port)
        if url is None:
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        else:
            upstream_writer.write(_origin_form(headers, method, url, version))
        await asyncio.gather(_pipe(reader, upstream_writer), _pipe(upstream_reader, writer))

    async def serve(self, host="0.0.0.0", port=3128):
        server = await asyncio.start_server(self.handle, host, port)
        log.info("proxy listening on %s:%d (allow_private=%s)", host, port, self.allow_private)
        async with server:
            await server.serve_forever()


def _proxy_password(headers):
    for line in headers:
        name, _, value = line.partition(":")
        if name.strip().lower() == "proxy-authorization":
            scheme, _, encoded = value.strip().partition(" ")
            if scheme.lower() == "basic":
                with contextlib.suppress(ValueError):
                    return base64.b64decode(encoded, validate=True).decode().partition(":")[2]
    return None


def _origin_form(headers, method, url, version):
    """Rewrite a proxy request for the origin server: path-only target, no proxy headers, one request."""
    path = (url.path or "/") + (f"?{url.query}" if url.query else "")
    kept = [h for h in headers if h and not h.lower().startswith(("proxy-", "connection:"))]
    return "\r\n".join([f"{method} {path} {version}", *kept, "Connection: close", "", ""]).encode("latin-1")


async def _connect(ips, port):
    """Connect to the first checked address that answers (e.g. IPv4 when IPv6 is unreachable)."""
    for ip in ips[:-1]:
        with contextlib.suppress(OSError, TimeoutError):
            return await asyncio.wait_for(asyncio.open_connection(ip, port), 10)
    return await asyncio.wait_for(asyncio.open_connection(ips[-1], port), 10)


async def _pipe(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except ConnectionError:
        pass
    finally:
        with contextlib.suppress(Exception):
            writer.close()


async def _respond(writer, status, message, extra_headers=""):
    body = (message + "\n").encode()
    writer.write(
        f"HTTP/1.1 {status.value} {status.phrase}\r\nContent-Type: text/plain\r\n{extra_headers}"
        f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
        + body
    )
    await writer.drain()


def main():
    import uvicorn

    from muse.config import Config
    from muse.llm import Embedder
    from muse.store import connect

    logging.basicConfig(level=logging.INFO)
    config = Config.from_env(os.environ)
    store = connect(config)
    policy = Policy(store, config.allowed_domains)
    proxy = Proxy(
        store,
        policy,
        platform_hosts=[f"{service}.{config.region}.amazonaws.com" for service in ("bedrock-runtime", "sts")],
        allow_private=config.allow_private,
    )
    gateway = create_gateway(store, policy, Embedder(config.embed_model_id, region=config.region))

    async def serve():
        server = uvicorn.Server(uvicorn.Config(gateway, host="0.0.0.0", port=8081))
        await asyncio.gather(proxy.serve(), server.serve())

    asyncio.run(serve())


if __name__ == "__main__":
    main()
