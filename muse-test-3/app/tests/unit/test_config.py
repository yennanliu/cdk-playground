from muse.config import Config


def test_defaults():
    config = Config.from_env({})
    assert config.model_id == "global.anthropic.claude-sonnet-5-5"
    assert config.allowed_domains == []


def test_from_env():
    config = Config.from_env(
        {
            "AWS_REGION": "ap-northeast-1",
            "MUSE_TABLE": "t",
            "MUSE_MEMORY_ID": "m",
            "MUSE_WORKER_ARN": "arn:w",
            "MUSE_ALLOWED_DOMAINS": " Wikipedia.org, ,example.com ",
        }
    )
    assert (config.region, config.table, config.memory_id, config.worker_arn) == ("ap-northeast-1", "t", "m", "arn:w")
    assert config.allowed_domains == ["wikipedia.org", "example.com"]
