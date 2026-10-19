"""Real AWS, no stack needed: AgentCore Browser through our CDP client, and the agent on Bedrock.

MUSE_LIVE=1 uv run pytest -m live        # uses your AWS credentials and AWS_REGION
"""

import os

import pytest

from muse.agent import reply
from muse.browser import Browser
from muse.config import Config
from tests.conftest import ALICE

pytestmark = [pytest.mark.live, pytest.mark.skipif(not os.environ.get("MUSE_LIVE"), reason="set MUSE_LIVE=1")]
REGION = os.environ.get("AWS_REGION", "ap-northeast-1")


def test_agentcore_browser_reads_a_page():
    assert "Example Domain" in Browser(REGION).fetch("https://example.com/")


class PageSentinel:
    def run(self, user, action, args):
        return Browser(REGION).fetch(args["url"]) if action == "browse" else "not available in this test"


def test_agent_browses_with_bedrock():
    config = Config(region=REGION, model_id=os.environ.get("MUSE_MODEL_ID", Config.model_id))
    payload = {
        "user": ALICE,
        "session": f"{ALICE}-live",
        "prompt": "What is the main heading on https://example.com/ ?",
    }
    assert "example domain" in reply(payload, config, PageSentinel())["reply"].lower()
