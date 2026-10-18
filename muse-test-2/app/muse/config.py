from dataclasses import dataclass, field


@dataclass(frozen=True)
class Config:
    database_url: str = "postgresql://muse@localhost:5432/muse"
    region: str | None = None
    # An inference profile, not a bare model ID: current Claude models reject on-demand bare IDs.
    model_id: str = "global.anthropic.claude-sonnet-5-5"
    embed_model_id: str = "amazon.titan-embed-text-v2:0"
    browser_url: str = "http://browser:8000"
    proxy_url: str = "http://sentinel:3128"
    allowed_domains: list[str] = field(default_factory=list)
    # Tests only: lets the sentinel reach a local web server.
    allow_private: bool = False
    scheduler_seconds: float = 30

    @classmethod
    def from_env(cls, env):
        return cls(
            database_url=env.get("DATABASE_URL", cls.database_url),
            region=env.get("AWS_REGION"),
            model_id=env.get("MUSE_MODEL_ID", cls.model_id),
            embed_model_id=env.get("MUSE_EMBED_MODEL_ID", cls.embed_model_id),
            browser_url=env.get("MUSE_BROWSER_URL", cls.browser_url),
            proxy_url=env.get("MUSE_PROXY_URL", cls.proxy_url),
            allowed_domains=[d.strip() for d in env.get("MUSE_ALLOWED_DOMAINS", "").split(",") if d.strip()],
            allow_private=env.get("MUSE_ALLOW_PRIVATE") == "1",
            scheduler_seconds=float(env.get("MUSE_SCHEDULER_SECONDS", cls.scheduler_seconds)),
        )
