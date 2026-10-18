"""Real Amazon Bedrock. Opt in with MUSE_LIVE=1 (uses your AWS credentials, costs a few cents)."""

import os

import pytest

from muse.agent import Agent
from muse.config import Config
from muse.llm import Bedrock
from muse.tools import Toolbox
from tests.conftest import FakeBrowser

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.environ.get("MUSE_LIVE") != "1", reason="set MUSE_LIVE=1 to call Bedrock"),
]


@pytest.fixture
def agent(store):
    config = Config.from_env(os.environ)
    return Agent(Bedrock(config.model_id, region=config.region), Toolbox(store, FakeBrowser()), store)


def test_model_uses_remember_tool(agent, store):
    agent.chat("live", "Please remember that my favourite colour is teal.")
    assert any("teal" in m["text"].lower() for m in store.memories())


def test_model_answers_from_memory(agent, store):
    store.remember("The user's dog is named Mochi.")
    assert "mochi" in agent.chat("live", "What is my dog's name?").lower()
