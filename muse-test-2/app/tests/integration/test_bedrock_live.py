"""Real Bedrock (Claude + Titan embeddings). Opt in with MUSE_LIVE=1; costs a few cents."""

import os

import pytest

from muse.agent import Agent
from muse.config import Config
from muse.llm import Bedrock, Embedder
from muse.tools import Toolbox
from tests.conftest import FakeBrowser

pytestmark = [
    pytest.mark.live,
    pytest.mark.postgres,
    pytest.mark.skipif(os.environ.get("MUSE_LIVE") != "1", reason="set MUSE_LIVE=1 to call Bedrock"),
]


@pytest.fixture
def config():
    return Config.from_env(os.environ)


@pytest.fixture
def titan(config):
    return Embedder(config.embed_model_id, region=config.region)


def test_embeddings_are_semantic(store, titan):
    for text in ["My dog Mochi is a shiba inu", "I work as a nurse", "I prefer window seats on flights"]:
        store.remember(text, titan.embed(text))
    assert "Mochi" in store.recall(titan.embed("what pet do I have?"), k=1)[0]["text"]


def test_agent_remembers_and_answers_from_memory(store, titan, config):
    agent = Agent(Bedrock(config.model_id, region=config.region), Toolbox(store, FakeBrowser(), titan), store, titan)
    agent.chat("live", "Please remember that my favourite colour is teal.")
    assert any("teal" in m["text"].lower() for m in store.memories())
    assert "teal" in agent.chat("live-2", "What is my favourite colour?").lower()
