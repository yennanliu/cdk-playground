import pytest

from muse.agent import Agent
from muse.tools import Toolbox
from tests.conftest import FakeBrowser, ScriptedLLM, call, say


def make_agent(store, *responses, max_steps=8):
    llm = ScriptedLLM(*responses)
    return Agent(llm, Toolbox(store, FakeBrowser()), store, max_steps=max_steps), llm


def test_plain_reply(store):
    agent, llm = make_agent(store, say("Hello!"))
    assert agent.chat("s1", "hi") == "Hello!"
    assert llm.calls[0]["messages"] == [{"role": "user", "content": [{"text": "hi"}]}]


def test_tool_loop_feeds_results_back(store):
    agent, llm = make_agent(store, call("remember", text="I like tea"), say("Noted."))
    assert agent.chat("s1", "remember I like tea") == "Noted."
    assert store.memories()[0]["text"] == "I like tea"

    result_msg = llm.calls[1]["messages"][-1]
    assert result_msg["role"] == "user"
    tool_result = result_msg["content"][0]["toolResult"]
    assert "Saved memory" in tool_result["content"][0]["text"]


def test_memories_are_in_the_system_prompt(store):
    store.remember("I am allergic to peanuts")
    agent, llm = make_agent(store, say("ok"))
    agent.chat("s1", "suggest a snack")
    assert "I am allergic to peanuts" in llm.calls[0]["system"]


def test_history_persists_across_turns(store):
    agent, llm = make_agent(store, say("Hi Jim"), say("You said hi"))
    agent.chat("s1", "hi, I'm Jim")
    agent.chat("s1", "what did I say?")
    sent = llm.calls[1]["messages"]
    assert [m["role"] for m in sent] == ["user", "assistant", "user"]
    assert sent[0]["content"][0]["text"] == "hi, I'm Jim"


def test_sessions_are_isolated(store):
    agent, llm = make_agent(store, say("a"), say("b"))
    agent.chat("s1", "one")
    agent.chat("s2", "two")
    assert len(llm.calls[1]["messages"]) == 1


def test_stops_after_max_steps(store):
    agent, _ = make_agent(store, *[call("recall", query="x")] * 3, max_steps=3)
    assert "step limit" in agent.chat("s1", "loop forever")


def test_history_is_trimmed_at_a_user_turn(store):
    agent, _ = make_agent(store, *[say("ok")] * 30)
    agent.max_history = 6
    for i in range(30):
        agent.chat("s1", f"msg {i}")
    history = store.history("s1")
    assert len(history) <= 6
    assert history[0]["role"] == "user" and "text" in history[0]["content"][0]


def test_run_task_does_not_touch_chat_history(store):
    agent, _ = make_agent(store, say("Weather is sunny"))
    assert agent.run_task("check weather") == "Weather is sunny"
    assert store.history("s1") == []


def test_model_errors_propagate(store):
    class Boom:
        def converse(self, *a):
            raise RuntimeError("throttled")

    agent = Agent(Boom(), Toolbox(store, FakeBrowser()), store)
    with pytest.raises(RuntimeError):
        agent.chat("s1", "hi")
