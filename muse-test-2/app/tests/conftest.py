"""Shared fixtures. Postgres is real (a throwaway pgvector container); the model,
embeddings and browser are faked unless a test says otherwise."""

import hashlib
import itertools
import math
import os
import re
import shutil
import subprocess
import time

import psycopg
import pytest

from muse.store import Store

_ids = itertools.count(1)
PG_RUN = [
    "docker",
    "run",
    "-d",
    "--rm",
    "-e",
    "POSTGRES_PASSWORD=test",
    "-p",
    "127.0.0.1::5432",
    "pgvector/pgvector:pg17",
]


def say(text):
    """A Bedrock Converse response that ends the turn with `text`."""
    return {"stopReason": "end_turn", "output": {"message": {"role": "assistant", "content": [{"text": text}]}}}


def call(name, **args):
    """A Bedrock Converse response that asks for one tool call."""
    block = {"toolUse": {"toolUseId": f"t{next(_ids)}", "name": name, "input": args}}
    return {"stopReason": "tool_use", "output": {"message": {"role": "assistant", "content": [block]}}}


class ScriptedLLM:
    """Plays back canned responses and records what it was sent."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def converse(self, system, messages, tools):
        self.calls.append({"system": system, "messages": list(messages), "tools": tools})
        if not self.responses:
            raise AssertionError("ScriptedLLM ran out of responses")
        return self.responses.pop(0)


class FakeEmbedder:
    """Bag-of-words hashed into a unit vector: texts sharing words are close."""

    dimensions = 512

    def embed(self, text):
        vec = [0.0] * self.dimensions
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            vec[int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dimensions] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


class FakeBrowser:
    def __init__(self, pages=None):
        self.pages = pages or {}
        self.visited = []

    def fetch(self, url):
        self.visited.append(url)
        return self.pages.get(url, f"page at {url}")


@pytest.fixture(scope="session")
def database_url():
    """MUSE_TEST_DATABASE_URL if set, else a pgvector container for the whole session."""
    if url := os.environ.get("MUSE_TEST_DATABASE_URL"):
        yield url
        return
    if not shutil.which("docker") or subprocess.run(["docker", "info"], check=False, capture_output=True).returncode:
        pytest.skip("needs Docker or MUSE_TEST_DATABASE_URL")
    cid = subprocess.check_output(PG_RUN, text=True).strip()
    try:
        port = subprocess.check_output(["docker", "port", cid, "5432/tcp"], text=True).split(":")[-1].strip()
        url = f"postgresql://postgres:test@127.0.0.1:{port}/postgres"
        for _ in range(60):
            try:
                psycopg.connect(url, connect_timeout=1).close()
                break
            except psycopg.OperationalError:
                time.sleep(0.5)
        yield url
    finally:
        subprocess.run(["docker", "rm", "-f", cid], check=False, capture_output=True)


@pytest.fixture
def fresh_db(database_url):
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
    return database_url


@pytest.fixture
def store(fresh_db):
    s = Store(fresh_db)
    yield s
    s.close()


@pytest.fixture
def embedder():
    return FakeEmbedder()
