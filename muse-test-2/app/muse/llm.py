import json

import boto3

from muse.store import DIMENSIONS


class Bedrock:
    """Thin wrapper over the Bedrock Converse API; the agent only needs `converse`."""

    def __init__(self, model_id, region=None, client=None, max_tokens=4096):
        self.model_id = model_id
        self.max_tokens = max_tokens
        self.client = client or boto3.client("bedrock-runtime", region_name=region)

    def converse(self, system, messages, tools):
        kwargs = {
            "modelId": self.model_id,
            "system": [{"text": system}],
            "messages": messages,
            "inferenceConfig": {"maxTokens": self.max_tokens},
        }
        if tools:
            kwargs["toolConfig"] = {"tools": tools}
        return self.client.converse(**kwargs)


class Embedder:
    """Titan text embeddings, normalized, sized to the pgvector column."""

    def __init__(self, model_id, region=None, client=None):
        self.model_id = model_id
        self.client = client or boto3.client("bedrock-runtime", region_name=region)

    def embed(self, text):
        body = json.dumps({"inputText": text, "dimensions": DIMENSIONS, "normalize": True})
        response = self.client.invoke_model(modelId=self.model_id, body=body)
        return json.loads(response["body"].read())["embedding"]
