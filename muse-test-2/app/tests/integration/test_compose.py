"""The whole compose stack on this machine, with real Bedrock, Chromium and the internet.

    MUSE_COMPOSE=1 uv run pytest -m compose      # needs Docker and AWS credentials

Besides the shared HTTP contract, this checks what only a local run can: that
the network layout really isolates the browser and the scheduler.
"""

import json
import os
import secrets
import subprocess
from pathlib import Path

import httpx
import pytest

from tests.integration.contract import StackContract

pytestmark = [
    pytest.mark.compose,
    pytest.mark.skipif(os.environ.get("MUSE_COMPOSE") != "1", reason="set MUSE_COMPOSE=1 to run the compose stack"),
]

APP = Path(__file__).parents[2]
COMPOSE = ["docker", "compose", "-p", "muse-test", "-f", "compose.yaml", "-f", "compose.local.yaml"]


def compose(*args, check=True):
    return subprocess.run([*COMPOSE, *args], cwd=APP, env=ENV, capture_output=True, text=True, check=check)


def aws_credentials():
    out = subprocess.check_output(["aws", "configure", "export-credentials", "--format", "process"], text=True)
    creds = json.loads(out)
    return {
        "AWS_ACCESS_KEY_ID": creds["AccessKeyId"],
        "AWS_SECRET_ACCESS_KEY": creds["SecretAccessKey"],
        "AWS_SESSION_TOKEN": creds.get("SessionToken", ""),
    }


ENV = {}


@pytest.fixture(scope="module")
def http():
    ENV.update(
        os.environ,
        POSTGRES_PASSWORD=secrets.token_hex(16),
        AWS_REGION=os.environ.get("AWS_REGION", "ap-northeast-1"),
        MUSE_PORT="18081",
        **aws_credentials(),
    )
    try:
        compose("up", "-d", "--build", "--wait", "--wait-timeout", "300")
    except subprocess.CalledProcessError as e:
        print(e.stdout, e.stderr, compose("logs", "--tail", "50", check=False).stdout)
        raise
    try:
        with httpx.Client(base_url="http://127.0.0.1:18081", timeout=60) as client:
            yield client
    finally:
        compose("down", "-v", check=False)


class TestCompose(StackContract):
    def exec_python(self, service, code):
        return compose("exec", "-T", service, "python", "-c", code, check=False).returncode

    def test_browser_has_no_direct_internet(self, http):
        assert self.exec_python("browser", "import urllib.request as u; u.urlopen('https://example.com', timeout=5)")

    def test_browser_cannot_reach_postgres(self, http):
        assert self.exec_python("browser", "import socket; socket.create_connection(('postgres', 5432), timeout=3)")

    def test_browser_holds_no_secrets(self, http):
        code = "import os, sys; sys.exit(any(k in os.environ for k in ('DATABASE_URL', 'AWS_ACCESS_KEY_ID')))"
        assert self.exec_python("browser", code) == 0

    def test_scheduler_has_no_internet(self, http):
        assert self.exec_python("scheduler", "import urllib.request as u; u.urlopen('https://example.com', timeout=5)")

    def test_sentinel_refuses_metadata_even_when_approved(self, http):
        # The agent never asks for link-local, so seed the approval straight into Postgres.
        sql = "INSERT INTO approvals (domain, status) VALUES ('169.254.169.254', 'approved')"
        compose("exec", "-T", "postgres", "psql", "-U", "muse", "-c", sql)
        code = (
            "import urllib.request as u, sys\n"
            "opener = u.build_opener(u.ProxyHandler({'http': 'http://sentinel:3128'}))\n"
            "try:\n"
            "    opener.open('http://169.254.169.254/latest/meta-data/', timeout=5)\n"
            "except u.HTTPError as e:\n"
            "    sys.exit(0 if e.code == 403 and b'link-local' in e.read() else 1)\n"
            "sys.exit(1)\n"
        )
        assert self.exec_python("browser", code) == 0

    def test_two_workers_are_running(self, http):
        assert len(compose("ps", "-q", "worker").stdout.split()) == 2
