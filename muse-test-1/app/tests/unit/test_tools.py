import pytest

from muse.tools import Toolbox
from tests.conftest import FakeBrowser


@pytest.fixture
def browser():
    return FakeBrowser({"https://example.com/": "Example Domain"})


@pytest.fixture
def toolbox(store, browser):
    return Toolbox(store, browser, clock=lambda: 1000)


def test_specs_are_bedrock_tool_specs(toolbox):
    names = {s["toolSpec"]["name"] for s in toolbox.specs()}
    assert names == {"remember", "recall", "forget", "browse", "schedule_task"}
    for spec in toolbox.specs():
        assert spec["toolSpec"]["inputSchema"]["json"]["type"] == "object"


class TestMemoryTools:
    def test_remember_then_recall(self, toolbox, store):
        assert "Saved memory #1" in toolbox.run("remember", {"text": "I like jazz"})
        assert "I like jazz" in toolbox.run("recall", {"query": "jazz"})

    def test_recall_nothing(self, toolbox):
        assert toolbox.run("recall", {"query": "jazz"}) == "No matching memories."

    def test_forget(self, toolbox, store):
        mid = store.remember("old")
        assert "Forgot" in toolbox.run("forget", {"id": mid})
        assert store.memories() == []


class TestBrowseSentinel:
    def test_unapproved_domain_is_blocked_and_requests_approval(self, toolbox, store, browser):
        out = toolbox.run("browse", {"url": "https://example.com/"})
        assert "approval" in out.lower()
        assert browser.visited == []
        assert store.approvals()[0]["domain"] == "example.com"

    def test_approved_domain_is_fetched(self, toolbox, store, browser):
        store.decide(store.request_domain("example.com"), approve=True)
        assert toolbox.run("browse", {"url": "https://example.com/"}) == "Example Domain"
        assert browser.visited == ["https://example.com/"]

    @pytest.mark.parametrize(
        "url",
        ["file:///etc/passwd", "ftp://example.com/", "http://169.254.169.254/latest/meta-data/", "not a url"],
    )
    def test_never_fetches_dangerous_urls(self, toolbox, store, browser, url):
        out = toolbox.run("browse", {"url": url})
        assert out.startswith("Refused")
        assert browser.visited == []
        assert store.approvals() == []

    def test_browser_errors_become_tool_output(self, store):
        class Broken:
            def fetch(self, url):
                raise RuntimeError("net::ERR_NAME_NOT_RESOLVED")

        store.decide(store.request_domain("example.com"), approve=True)
        out = Toolbox(store, Broken()).run("browse", {"url": "https://example.com/"})
        assert "ERR_NAME_NOT_RESOLVED" in out


def test_schedule_task(toolbox, store):
    out = toolbox.run("schedule_task", {"prompt": "summarize the news", "every_minutes": 1440})
    assert "Scheduled task #1" in out
    assert store.tasks()[0]["prompt"] == "summarize the news"


def test_unknown_tool(toolbox):
    assert toolbox.run("rm_rf", {}) == "Unknown tool: rm_rf"


def test_every_call_is_audited(toolbox, store):
    toolbox.run("remember", {"text": "x"})
    entry = store.audit_log()[0]
    assert entry["event"] == "tool"
    assert entry["detail"]["name"] == "remember"
    assert entry["detail"]["input"] == {"text": "x"}
