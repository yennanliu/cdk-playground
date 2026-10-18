import pytest

from muse.tools import Toolbox
from tests.conftest import FakeBrowser

pytestmark = pytest.mark.postgres


@pytest.fixture
def browser():
    return FakeBrowser({"https://example.com/": "Example Domain"})


@pytest.fixture
def toolbox(store, browser, embedder):
    return Toolbox(store, browser, embedder, clock=lambda: 1000)


def test_specs(toolbox):
    names = {s["toolSpec"]["name"] for s in toolbox.specs()}
    assert names == {"remember", "recall", "forget", "browse", "schedule_task"}


class TestMemoryTools:
    def test_remember_then_semantic_recall(self, toolbox):
        toolbox.run("remember", {"text": "My sister Amy lives in Osaka"})
        toolbox.run("remember", {"text": "I am vegetarian"})
        assert (
            toolbox.run("recall", {"query": "where does my sister live"})
            .splitlines()[0]
            .endswith("My sister Amy lives in Osaka")
        )

    def test_recall_nothing(self, toolbox):
        assert toolbox.run("recall", {"query": "anything"}) == "No memories yet."

    def test_forget(self, toolbox, store, embedder):
        mid = store.remember("old", embedder.embed("old"))
        assert "Forgot" in toolbox.run("forget", {"id": mid})
        assert store.memories() == []


class TestBrowse:
    def test_unapproved_domain_requests_approval_without_fetching(self, toolbox, store, browser):
        out = toolbox.run("browse", {"url": "https://example.com/"})
        assert "approval request #" in out.lower()
        assert browser.visited == []
        assert store.approvals()[0]["domain"] == "example.com"

    def test_approved_domain_is_fetched(self, toolbox, store, browser):
        store.decide(store.request_domain("example.com"), approve=True)
        assert toolbox.run("browse", {"url": "https://example.com/"}) == "Example Domain"

    @pytest.mark.parametrize("url", ["file:///etc/passwd", "http://169.254.169.254/latest/", "http://10.0.0.1/"])
    def test_refused_outright(self, toolbox, store, browser, url):
        assert toolbox.run("browse", {"url": url}).startswith("Refused")
        assert browser.visited == [] and store.approvals() == []

    def test_browser_errors_become_tool_output(self, store, embedder):
        class Broken:
            def fetch(self, url):
                raise RuntimeError("net::ERR_TUNNEL_CONNECTION_FAILED")

        store.decide(store.request_domain("example.com"), approve=True)
        out = Toolbox(store, Broken(), embedder).run("browse", {"url": "https://example.com/"})
        assert "ERR_TUNNEL_CONNECTION_FAILED" in out


def test_schedule_task(toolbox, store):
    assert "Scheduled task #" in toolbox.run("schedule_task", {"prompt": "news digest", "every_minutes": 1440})
    assert store.tasks()[0]["next_run"] == 1000


def test_unknown_tool_and_audit(toolbox, store):
    assert toolbox.run("rm_rf", {}) == "Unknown tool: rm_rf"
    assert store.audit_log()[0]["detail"] == {"name": "rm_rf", "input": {}}
