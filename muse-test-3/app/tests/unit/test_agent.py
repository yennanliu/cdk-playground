"""The agent with a scripted model in place of Bedrock: Strands' real loop, our tools, a fake sentinel."""

import io
import json

from strands.models.model import Model

from muse.agent import BACKGROUND, SentinelClient, reply
from muse.config import Config
from tests.conftest import ALICE


class ScriptedModel(Model):
    """Plays back canned assistant messages as Strands stream events and records what it was sent."""

    def __init__(self, *turns):
        self.turns = list(turns)
        self.calls = []

    def update_config(self, **_):
        pass

    def get_config(self):
        return {}

    async def structured_output(self, *_args, **_kwargs):
        raise NotImplementedError

    async def stream(self, messages, tool_specs=None, system_prompt=None, **_):
        self.calls.append({"messages": [dict(m) for m in messages], "tools": tool_specs, "system": system_prompt})
        yield {"messageStart": {"role": "assistant"}}
        stop = "end_turn"
        for block in self.turns.pop(0):
            if "text" in block:
                yield {"contentBlockStart": {"start": {}}}
                yield {"contentBlockDelta": {"delta": {"text": block["text"]}}}
            else:
                stop = "tool_use"
                call = block["toolUse"]
                yield {"contentBlockStart": {"start": {"toolUse": {"name": call["name"], "toolUseId": call["id"]}}}}
                yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(call["input"])}}}}
            yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": stop}}


def say(text):
    return [{"text": text}]


def call(name, **args):
    return [{"toolUse": {"id": f"t-{name}", "name": name, "input": args}}]


class FakeSentinel:
    def __init__(self, result="done"):
        self.result = result
        self.calls = []

    def run(self, user, action, args):
        self.calls.append((user, action, args))
        return self.result


CONFIG = Config(memory_id="")  # no AgentCore Memory in unit tests


def payload(prompt, **extra):
    return {"user": ALICE, "session": f"{ALICE}-default", "prompt": prompt, **extra}


def test_plain_answer():
    model = ScriptedModel(say("Hello!"))
    assert reply(payload("hi"), CONFIG, FakeSentinel(), model) == {"reply": "Hello!"}
    assert "You are Muse" in model.calls[0]["system"]
    assert {t["name"] for t in model.calls[0]["tools"]} == {"browse", "schedule_task"}


def test_tools_go_through_the_sentinel_as_the_payload_user():
    sentinel = FakeSentinel("Example Domain")
    model = ScriptedModel(call("browse", url="https://example.com/"), say("It says Example Domain."))
    assert reply(payload("what is on example.com?"), CONFIG, sentinel, model)["reply"] == "It says Example Domain."
    assert sentinel.calls == [(ALICE, "browse", {"url": "https://example.com/"})]
    tool_result = model.calls[1]["messages"][-1]["content"][0]["toolResult"]
    assert tool_result["content"] == [{"text": "Example Domain"}]


def test_schedule_task_tool():
    sentinel = FakeSentinel("Scheduled task abc every 60 minutes.")
    model = ScriptedModel(call("schedule_task", prompt="news", every_minutes=60), say("Scheduled."))
    reply(payload("send me news hourly"), CONFIG, sentinel, model)
    assert sentinel.calls == [(ALICE, "schedule_task", {"prompt": "news", "every_minutes": 60})]


def test_background_prompt_is_marked():
    model = ScriptedModel(say("3 headlines"))
    reply(payload("check the news", background=True), CONFIG, FakeSentinel(), model)
    assert model.calls[0]["messages"][0]["content"][0]["text"] == BACKGROUND + "check the news"


class FakeLambda:
    def __init__(self, body, error=False):
        self.body = body
        self.error = error
        self.calls = []

    def invoke(self, FunctionName, Payload):
        self.calls.append((FunctionName, json.loads(Payload)))
        response = {"Payload": io.BytesIO(json.dumps(self.body).encode())}
        if self.error:
            response["FunctionError"] = "Unhandled"
        return response


def test_sentinel_client_sends_user_action_and_input():
    client = FakeLambda({"result": "page text"})
    assert SentinelClient("arn:sentinel", client=client).run(ALICE, "browse", {"url": "https://x"}) == "page text"
    assert client.calls == [("arn:sentinel", {"user": ALICE, "action": "browse", "input": {"url": "https://x"}})]


def test_sentinel_crash_becomes_text_for_the_model():
    client = FakeLambda({"errorMessage": "Task timed out"}, error=True)
    assert SentinelClient("arn:sentinel", client=client).run(ALICE, "browse", {}) == "Error: Task timed out"
