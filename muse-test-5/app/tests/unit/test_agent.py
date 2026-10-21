from muse.agent import BACKGROUND, Agent, Toolbox


def reply(text):
    return {"output": {"message": {"role": "assistant", "content": [{"text": text}]}}, "stopReason": "end_turn"}


def tool_call(name, args, call_id="t1"):
    content = [{"toolUse": {"toolUseId": call_id, "name": name, "input": args}}]
    return {"output": {"message": {"role": "assistant", "content": content}}, "stopReason": "tool_use"}


class ScriptedModel:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def converse(self, system, messages, tools):
        self.calls.append({"system": system, "messages": [*messages]})
        return self.responses.pop(0)


class FakeTools:
    def __init__(self):
        self.ran = []

    def specs(self):
        return []

    def run(self, name, args):
        self.ran.append((name, args))
        return f"{name} done"


def turn(prompt="hi", kind="chat", history=(), memories=()):
    return {"id": "t", "kind": kind, "prompt": prompt, "history": list(history), "memories": list(memories)}


def test_answers_with_memories_in_the_prompt():
    model = ScriptedModel(reply("Hello!"))
    text, messages = Agent(model, FakeTools()).run(turn(memories=[{"id": "m1", "text": "Name is Jo"}]))
    assert text == "Hello!"
    assert "- m1: Name is Jo" in model.calls[0]["system"]
    assert [m["role"] for m in messages] == ["user", "assistant"]


def test_runs_tools_until_it_answers():
    tools = FakeTools()
    model = ScriptedModel(tool_call("remember", {"text": "likes tea"}), reply("Noted."))
    text, messages = Agent(model, tools).run(turn("I like tea"))
    assert text == "Noted." and tools.ran == [("remember", {"text": "likes tea"})]
    result = messages[2]["content"][0]["toolResult"]
    assert result == {"toolUseId": "t1", "content": [{"text": "remember done"}]}


def test_continues_the_chat_history():
    history = [{"role": "user", "content": [{"text": "earlier"}]}, {"role": "assistant", "content": [{"text": "ok"}]}]
    model = ScriptedModel(reply("again"))
    _, messages = Agent(model, FakeTools()).run(turn("now", history=history))
    assert model.calls[0]["messages"][0]["content"][0]["text"] == "earlier"
    assert len(messages) == 4


def test_background_tasks_are_marked():
    model = ScriptedModel(reply("done"))
    Agent(model, FakeTools()).run(turn("check prices", kind="task"))
    assert model.calls[0]["messages"][-1]["content"][0]["text"] == BACKGROUND + "check prices"


def test_a_refusal_keeps_nothing_of_the_turn():
    refused = {"output": {"message": {"role": "assistant", "content": []}}, "stopReason": "content_filtered"}
    text, messages = Agent(ScriptedModel(refused), FakeTools()).run(turn("something bad"))
    assert "content_filtered" in text and messages is None


def test_step_limit_closes_the_turn():
    model = ScriptedModel(*[tool_call("recall", {"query": "x"}, f"t{i}") for i in range(3)])
    text, messages = Agent(model, FakeTools(), max_steps=3).run(turn())
    assert "step limit" in text and messages[-1]["role"] == "assistant"


def test_history_is_trimmed_to_whole_exchanges():
    agent = Agent(ScriptedModel(), FakeTools(), max_messages=3)
    messages = [
        {"role": "user", "content": [{"text": "a"}]},
        {"role": "assistant", "content": [{"toolUse": {}}]},
        {"role": "user", "content": [{"toolResult": {}}]},
        {"role": "assistant", "content": [{"text": "b"}]},
        {"role": "user", "content": [{"text": "c"}]},
        {"role": "assistant", "content": [{"text": "d"}]},
    ]
    assert agent._trim(messages) == messages[4:]  # never starts on a tool result
    assert Agent(ScriptedModel(), FakeTools(), max_bytes=100)._trim(messages) == messages[4:]


class FakeGateway:
    def __init__(self, reason=None):
        self.reason = reason
        self.acted = []

    def permit(self, url):
        return self.reason

    def act(self, name, args):
        self.acted.append(name)
        return f"{name} ok"


class FakeBrowser:
    def fetch(self, url):
        return f"page {url}"


def test_toolbox_browses_only_when_permitted():
    assert Toolbox(FakeGateway(), FakeBrowser()).run("browse", {"url": "https://a.com"}) == "page https://a.com"
    blocked = Toolbox(FakeGateway("Blocked: ask the user"), FakeBrowser())
    assert blocked.run("browse", {"url": "https://a.com"}) == "Blocked: ask the user"


def test_toolbox_sends_the_rest_to_the_sentinel():
    gateway = FakeGateway()
    assert Toolbox(gateway, FakeBrowser()).run("remember", {"text": "x"}) == "remember ok"
    assert Toolbox(gateway, FakeBrowser()).run("browse", {}).startswith("Error")
