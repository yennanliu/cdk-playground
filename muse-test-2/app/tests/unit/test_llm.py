import io
import json

from muse.llm import Bedrock, Embedder


class FakeClient:
    def __init__(self):
        self.kwargs = None

    def converse(self, **kwargs):
        self.kwargs = kwargs
        return {"stopReason": "end_turn", "output": {"message": {"role": "assistant", "content": []}}}

    def invoke_model(self, **kwargs):
        self.kwargs = kwargs
        return {"body": io.BytesIO(json.dumps({"embedding": [0.1, 0.2]}).encode())}


def test_converse_request_shape():
    client = FakeClient()
    tools = [{"toolSpec": {"name": "t", "description": "d", "inputSchema": {"json": {"type": "object"}}}}]
    msgs = [{"role": "user", "content": [{"text": "hi"}]}]
    Bedrock("global.anthropic.claude-sonnet-5-5", client=client).converse("be nice", msgs, tools)
    assert client.kwargs["modelId"] == "global.anthropic.claude-sonnet-5-5"
    assert client.kwargs["system"] == [{"text": "be nice"}]
    assert client.kwargs["messages"] == msgs
    assert client.kwargs["toolConfig"] == {"tools": tools}


def test_converse_without_tools_omits_tool_config():
    client = FakeClient()
    Bedrock("m", client=client).converse("s", [], [])
    assert "toolConfig" not in client.kwargs


def test_embedder_calls_titan_with_fixed_dimensions():
    client = FakeClient()
    assert Embedder("amazon.titan-embed-text-v2:0", client=client).embed("hello") == [0.1, 0.2]
    assert client.kwargs["modelId"] == "amazon.titan-embed-text-v2:0"
    assert json.loads(client.kwargs["body"]) == {"inputText": "hello", "dimensions": 512, "normalize": True}
