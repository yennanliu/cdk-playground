from muse.llm import Bedrock


class FakeClient:
    def __init__(self):
        self.kwargs = None

    def converse(self, **kwargs):
        self.kwargs = kwargs
        return {"stopReason": "end_turn", "output": {"message": {"role": "assistant", "content": []}}}


def test_converse_passes_model_system_messages_and_tools():
    client = FakeClient()
    tools = [{"toolSpec": {"name": "t", "description": "d", "inputSchema": {"json": {"type": "object"}}}}]
    msgs = [{"role": "user", "content": [{"text": "hi"}]}]

    out = Bedrock("global.anthropic.claude-sonnet-5-5", client=client).converse("be nice", msgs, tools)

    assert out["stopReason"] == "end_turn"
    assert client.kwargs["modelId"] == "global.anthropic.claude-sonnet-5-5"
    assert client.kwargs["system"] == [{"text": "be nice"}]
    assert client.kwargs["messages"] == msgs
    assert client.kwargs["toolConfig"] == {"tools": tools}
    assert client.kwargs["inferenceConfig"]["maxTokens"] > 0


def test_no_tools_omits_tool_config():
    client = FakeClient()
    Bedrock("m", client=client).converse("s", [], [])
    assert "toolConfig" not in client.kwargs
