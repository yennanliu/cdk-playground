from dataclasses import dataclass, field


@dataclass(frozen=True)
class Config:
    db_path: str = "/data/muse.db"
    # An inference profile, not a bare model ID: current Claude models reject on-demand bare IDs.
    model_id: str = "global.anthropic.claude-sonnet-5-5"
    region: str | None = None
    allowed_domains: list[str] = field(default_factory=list)
    scheduler_seconds: float = 30

    @classmethod
    def from_env(cls, env):
        return cls(
            db_path=env.get("MUSE_DB", cls.db_path),
            model_id=env.get("MUSE_MODEL_ID", cls.model_id),
            region=env.get("AWS_REGION"),
            allowed_domains=[d.strip() for d in env.get("MUSE_ALLOWED_DOMAINS", "").split(",") if d.strip()],
            scheduler_seconds=float(env.get("MUSE_SCHEDULER_SECONDS", cls.scheduler_seconds)),
        )
