"""Shared fixtures. DynamoDB is moto's; the model, embeddings and launchers are small fakes."""

import asyncio
import hashlib
import math
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import boto3
import pytest
from moto import mock_aws

from muse.llm import DIMENSIONS
from muse.sentinel import Policy, Proxy
from muse.store import Store, create_table, new_token, token_hash

ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"


class Clock:
    def __init__(self, now=1_700_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


class FakeEmbedder:
    """Bag-of-words vectors: texts sharing words are close, like real embeddings but deterministic."""

    def embed(self, text):
        vector = [0.0] * DIMENSIONS
        for word in text.lower().split():
            vector[int(hashlib.md5(word.strip(".,?!").encode()).hexdigest(), 16) % DIMENSIONS] += 1
        norm = math.sqrt(sum(v * v for v in vector)) or 1
        return [v / norm for v in vector]


class FakeLauncher:
    def __init__(self, error=None):
        self.error = error
        self.launched = []  # (user, token)
        self.stopped = []

    def launch(self, user, token):
        if self.error:
            raise self.error
        self.launched.append((user, token))
        return f"task-{len(self.launched)}"

    def stop(self, task):
        self.stopped.append(task)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def store(clock):
    with mock_aws():
        client = boto3.client("dynamodb", region_name="ap-northeast-1")
        create_table(client, "muse")
        yield Store(boto3.resource("dynamodb", region_name="ap-northeast-1").Table("muse"), clock=clock)


@pytest.fixture
def embedder():
    return FakeEmbedder()


def start_sandbox(store, user=ALICE):
    """Record a sandbox for `user`, as the api would; returns its token."""
    token = new_token(user)
    store.replace_sandbox(user, None, token_hash(token))
    return token


@pytest.fixture
def token(store):
    return start_sandbox(store)


class Hello(BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"hello from {self.headers['Host']}".encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def web():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Hello)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server.server_address[1]
    server.shutdown()


@pytest.fixture
def proxy_port(store):
    """The real proxy on a free port; allow_private lets it reach the local web server."""
    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, daemon=True).start()
    proxy = Proxy(store, Policy(store, ["localhost"]), allow_private=True)
    # Started on its own thread's loop: Playwright's sync API holds an event loop on this one.
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(proxy.handle, "127.0.0.1", 0), loop).result()
    yield server.sockets[0].getsockname()[1]
    loop.call_soon_threadsafe(loop.stop)
