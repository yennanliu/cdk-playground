"""Shared fakes. Everything below the model and the browser is real in tests."""

import itertools

import pytest

from muse.store import Store

_ids = itertools.count(1)


def say(text):
    """A Bedrock Converse response that ends the turn with `text`."""
    return {
        "stopReason": "end_turn",
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
    }


def call(name, **args):
    """A Bedrock Converse response that asks for one tool call."""
    return {
        "stopReason": "tool_use",
        "output": {
            "message": {
                "role": "assistant",
                "content": [{"toolUse": {"toolUseId": f"t{next(_ids)}", "name": name, "input": args}}],
            }
        },
    }


class ScriptedLLM:
    """Plays back canned responses and records what it was sent."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def converse(self, system, messages, tools):
        self.calls.append({"system": system, "messages": [m for m in messages], "tools": tools})
        if not self.responses:
            raise AssertionError("ScriptedLLM ran out of responses")
        return self.responses.pop(0)


class FakeBrowser:
    def __init__(self, pages=None):
        self.pages = pages or {}
        self.visited = []

    def fetch(self, url):
        self.visited.append(url)
        return self.pages.get(url, f"page at {url}")


@pytest.fixture
def store():
    s = Store(":memory:")
    yield s
    s.close()
