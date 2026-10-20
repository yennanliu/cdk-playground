import json
from dataclasses import dataclass, field


def _list(value):
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass(frozen=True)
class Config:
    """Everything comes from environment variables; each process reads what it needs."""

    region: str | None = None
    table: str = "muse"
    # Local runs point this at DynamoDB Local.
    dynamodb_endpoint: str | None = None
    # An inference profile, not a bare model ID: current Claude models reject on-demand bare IDs.
    model_id: str = "global.anthropic.claude-sonnet-5-5"
    embed_model_id: str = "amazon.titan-embed-text-v2:0"
    # Domains every user may browse without being asked.
    allowed_domains: list[str] = field(default_factory=list)
    # Tests only: lets the sentinel reach a local web server.
    allow_private: bool = False

    # api: without a user pool, tokens are trusted unsigned (local runs only).
    user_pool_id: str = ""
    user_pool_client_id: str = ""

    # api: where sandboxes run, "kube" (a Job per sandbox) or "docker" (local).
    launcher: str = "kube"
    sandbox_namespace: str = "sandboxes"
    # The sandbox Job the stack renders: image, gVisor, node pool, service account, resources.
    sandbox_job: dict = field(default_factory=dict)
    sandbox_image: str = "muse5:local"
    sandbox_network: str = "muse5_sandbox"

    # sandbox: its token (set per task at launch) and its one way out.
    token: str = ""
    gateway_url: str = "http://sentinel:8081"
    proxy_url: str = "http://sentinel:3128"
    idle_seconds: float = 600

    @classmethod
    def from_env(cls, env):
        return cls(
            region=env.get("AWS_REGION"),
            table=env.get("MUSE_TABLE", cls.table),
            dynamodb_endpoint=env.get("MUSE_DYNAMODB_ENDPOINT") or None,
            model_id=env.get("MUSE_MODEL_ID", cls.model_id),
            embed_model_id=env.get("MUSE_EMBED_MODEL_ID", cls.embed_model_id),
            allowed_domains=[d.lower() for d in _list(env.get("MUSE_ALLOWED_DOMAINS", ""))],
            allow_private=env.get("MUSE_ALLOW_PRIVATE") == "1",
            user_pool_id=env.get("MUSE_USER_POOL_ID", ""),
            user_pool_client_id=env.get("MUSE_USER_POOL_CLIENT_ID", ""),
            launcher=env.get("MUSE_LAUNCHER", cls.launcher),
            sandbox_namespace=env.get("MUSE_SANDBOX_NAMESPACE", cls.sandbox_namespace),
            sandbox_job=json.loads(env.get("MUSE_SANDBOX_JOB", "{}")),
            sandbox_image=env.get("MUSE_SANDBOX_IMAGE", cls.sandbox_image),
            sandbox_network=env.get("MUSE_SANDBOX_NETWORK", cls.sandbox_network),
            token=env.get("MUSE_TOKEN", ""),
            gateway_url=env.get("MUSE_GATEWAY_URL", cls.gateway_url),
            proxy_url=env.get("MUSE_PROXY_URL", cls.proxy_url),
            idle_seconds=float(env.get("MUSE_IDLE_SECONDS", cls.idle_seconds)),
        )
