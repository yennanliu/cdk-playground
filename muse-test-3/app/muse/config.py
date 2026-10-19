from dataclasses import dataclass, field

# Where AgentCore Memory's strategies file what they extract. Must match the
# strategy namespaces in lib/muse-test-3-stack.ts.
MEMORY_NAMESPACES = ("/users/{actorId}/facts", "/users/{actorId}/preferences")


@dataclass(frozen=True)
class Config:
    """Everything comes from environment variables the stack sets; each process reads what it needs."""

    region: str | None = None
    table: str = ""
    memory_id: str = ""
    # An inference profile, not a bare model ID: current Claude models reject on-demand bare IDs.
    model_id: str = "global.anthropic.claude-sonnet-5-5"
    runtime_arn: str = ""
    sentinel_arn: str = ""
    worker_arn: str = ""
    schedule_group: str = ""
    scheduler_role_arn: str = ""
    user_pool_client_id: str = ""
    allowed_domains: list[str] = field(default_factory=list)

    @classmethod
    def from_env(cls, env):
        return cls(
            region=env.get("AWS_REGION"),
            table=env.get("MUSE_TABLE", ""),
            memory_id=env.get("MUSE_MEMORY_ID", ""),
            model_id=env.get("MUSE_MODEL_ID", cls.model_id),
            runtime_arn=env.get("MUSE_RUNTIME_ARN", ""),
            sentinel_arn=env.get("MUSE_SENTINEL_ARN", ""),
            worker_arn=env.get("MUSE_WORKER_ARN", ""),
            schedule_group=env.get("MUSE_SCHEDULE_GROUP", ""),
            scheduler_role_arn=env.get("MUSE_SCHEDULER_ROLE_ARN", ""),
            user_pool_client_id=env.get("MUSE_USER_POOL_CLIENT_ID", ""),
            allowed_domains=[d.strip().lower() for d in env.get("MUSE_ALLOWED_DOMAINS", "").split(",") if d.strip()],
        )
