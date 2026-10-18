import pytest

from muse.agent import Agent
from muse.tools import Toolbox
from tests.conftest import FakeBrowser, ScriptedLLM, call, say

pytestmark = pytest.mark.postgres


@pytest.fixture
def make(store, embedder):
    def make(*responses, **kwargs):
        llm = ScriptedLLM(*responses)
        return Agent(llm, Toolbox(store, FakeBrowser(), embedder), store, embedder, **kwargs), llm

    return make


def test_plain_reply(make):
    agent, llm = make(say("Hello!"))
    assert agent.chat("s1", "hi") == "Hello!"
    assert llm.calls[0]["messages"] == [{"role": "user", "content": [{"text": "hi"}]}]


def test_tool_loop(make, store):
    agent, llm = make(call("remember", text="I like tea"), say("Noted."))
    assert agent.chat("s1", "remember I like tea") == "Noted."
    assert store.memories()[0]["text"] == "I like tea"
    assert "Saved memory" in llm.calls[1]["messages"][-1]["content"][0]["toolResult"]["content"][0]["text"]


def test_only_relevant_memories_go_in_the_prompt(make, store, embedder):
    for text in ["I am allergic to peanuts", "My car is a red Mazda", "I work at a bakery"]:
        store.remember(text, embedder.embed(text))
    agent, llm = make(say("ok"), memory_k=1)
    agent.chat("s1", "is this snack safe with peanuts?")
    assert "allergic to peanuts" in llm.calls[0]["system"]
    assert "Mazda" not in llm.calls[0]["system"]


def test_history_persists_and_sessions_are_isolated(make):
    agent, llm = make(say("a"), say("b"), say("c"))
    agent.chat("s1", "one")
    agent.chat("s1", "two")
    agent.chat("s2", "three")
    assert [m["role"] for m in llm.calls[1]["messages"]] == ["user", "assistant", "user"]
    assert len(llm.calls[2]["messages"]) == 1


def test_step_limit_closes_the_turn(make, store):
    agent, _ = make(*[call("recall", query="x")] * 3, max_steps=3)
    assert "step limit" in agent.chat("s1", "loop")
    assert store.history("s1")[-1]["role"] == "assistant"


def test_history_trimmed_at_a_user_turn(make, store):
    agent, _ = make(*[say("ok")] * 20, max_history=6)
    for i in range(20):
        agent.chat("s1", f"msg {i}")
    history = store.history("s1")
    assert len(history) <= 6 and "text" in history[0]["content"][0]


def test_empty_model_response_keeps_history_valid(make):
    # Seen on AWS in v1: a filtered request came back with no content blocks.
    empty = {"stopReason": "content_filtered", "output": {"message": {"role": "assistant", "content": []}}}
    agent, llm = make(empty, say("ok"))
    assert "content_filtered" in agent.chat("s1", "risky")
    agent.chat("s1", "next")
    assert all(m["content"] for m in llm.calls[1]["messages"])


def test_run_task_has_no_chat_history(make, store):
    agent, llm = make(say("done"))
    assert agent.run_task("check weather") == "done"
    assert "background task" in llm.calls[0]["messages"][0]["content"][0]["text"]
    assert store.history("s1") == []
