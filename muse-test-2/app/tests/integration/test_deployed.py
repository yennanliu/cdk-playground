"""The deployed agent box, reached through an SSM tunnel: same contract as compose.

../scripts/e2e-test.sh          # opens the tunnel, sets MUSE_URL, runs this file
"""

import os

import httpx
import pytest

from tests.integration.contract import StackContract

URL = os.environ.get("MUSE_URL")

pytestmark = [
    pytest.mark.deployed,
    pytest.mark.skipif(not URL, reason="set MUSE_URL (see scripts/e2e-test.sh)"),
]


@pytest.fixture(scope="module")
def http():
    with httpx.Client(base_url=URL, timeout=60) as client:
        yield client


class TestDeployed(StackContract):
    pass
