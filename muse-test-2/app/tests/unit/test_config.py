from muse.config import Config


def test_defaults():
    c = Config.from_env({})
    assert c.database_url == "postgresql://muse@localhost:5432/muse"
    assert c.model_id == "global.anthropic.claude-sonnet-5-5"
    assert c.embed_model_id == "amazon.titan-embed-text-v2:0"
    assert c.browser_url == "http://browser:8000"
    assert c.proxy_url == "http://sentinel:3128"
    assert c.allowed_domains == []
    assert c.allow_private is False


def test_from_env():
    c = Config.from_env(
        {
            "DATABASE_URL": "postgresql://u:p@db/x",
            "AWS_REGION": "ap-northeast-1",
            "MUSE_MODEL_ID": "jp.anthropic.claude-haiku-5-5",
            "MUSE_ALLOWED_DOMAINS": "wikipedia.org, example.com,",
            "MUSE_ALLOW_PRIVATE": "1",
            "MUSE_SCHEDULER_SECONDS": "5",
        }
    )
    assert c.database_url == "postgresql://u:p@db/x"
    assert c.region == "ap-northeast-1"
    assert c.model_id == "jp.anthropic.claude-haiku-5-5"
    assert c.allowed_domains == ["wikipedia.org", "example.com"]
    assert c.allow_private is True
    assert c.scheduler_seconds == 5
