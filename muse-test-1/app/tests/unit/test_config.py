from muse.config import Config


def test_defaults():
    c = Config.from_env({})
    assert c.db_path == "/data/muse.db"
    assert c.model_id == "global.anthropic.claude-sonnet-5-5"
    assert c.allowed_domains == []
    assert c.scheduler_seconds == 30


def test_from_env():
    c = Config.from_env(
        {
            "MUSE_DB": "/tmp/x.db",
            "MUSE_MODEL_ID": "jp.anthropic.claude-haiku-5-5",
            "MUSE_ALLOWED_DOMAINS": "wikipedia.org, example.com ,",
            "MUSE_SCHEDULER_SECONDS": "5",
            "AWS_REGION": "ap-northeast-1",
        }
    )
    assert c.db_path == "/tmp/x.db"
    assert c.model_id == "jp.anthropic.claude-haiku-5-5"
    assert c.allowed_domains == ["wikipedia.org", "example.com"]
    assert c.scheduler_seconds == 5
    assert c.region == "ap-northeast-1"
