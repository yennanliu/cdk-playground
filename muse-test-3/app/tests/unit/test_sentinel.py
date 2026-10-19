import json

import pytest

from muse.sentinel import Sentinel, domain_allowed, refusal
from tests.conftest import ALICE, BOB, FakeBrowser


@pytest.fixture
def browser():
    return FakeBrowser({"https://example.com/": "Example Domain"})


@pytest.fixture
def sentinel(store, browser, tasks):
    return Sentinel(store, browser, tasks, allowed_domains=["Wikipedia.org"])


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "http://localhost:8080/",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/",
        "https://",
    ],
)
def test_never_browsed(url):
    assert refusal(url)


def test_public_url_is_fine():
    assert refusal("https://example.com/a?b=c") is None


def test_domain_allowed_matches_subdomains_only():
    assert domain_allowed("en.wikipedia.org", {"wikipedia.org"})
    assert domain_allowed("WIKIPEDIA.org", {"wikipedia.org"})
    assert not domain_allowed("notwikipedia.org", {"wikipedia.org"})


def test_seeded_domain_is_browsed(sentinel, browser):
    assert sentinel.run(ALICE, "browse", {"url": "https://en.wikipedia.org/wiki/Muse"}).startswith("page at")
    assert browser.visited == ["https://en.wikipedia.org/wiki/Muse"]


def test_unknown_domain_asks_the_user_and_browses_once_approved(sentinel, store, browser):
    result = sentinel.run(ALICE, "browse", {"url": "https://example.com/"})
    assert result.startswith("Blocked") and browser.visited == []
    assert [(a["domain"], a["status"]) for a in store.approvals(ALICE)] == [("example.com", "pending")]

    store.decide(ALICE, "example.com", True)
    assert sentinel.run(ALICE, "browse", {"url": "https://example.com/"}) == "Example Domain"
    # Alice's approval is not Bob's.
    assert sentinel.run(BOB, "browse", {"url": "https://example.com/"}).startswith("Blocked")


def test_denied_domain_says_so(sentinel, store):
    store.request_domain(ALICE, "example.com")
    store.decide(ALICE, "example.com", False)
    assert "denied" in sentinel.run(ALICE, "browse", {"url": "https://example.com/"})


def test_refused_url_never_reaches_the_browser(sentinel, browser, store):
    assert sentinel.run(ALICE, "browse", {"url": "http://169.254.169.254/"}).startswith("Refused")
    assert browser.visited == [] and store.approvals(ALICE) == []


def test_schedule_task_creates_row_and_schedule(sentinel, store, scheduler):
    assert sentinel.run(ALICE, "schedule_task", {"prompt": "daily news", "every_minutes": 1440}).startswith("Scheduled")
    (task,) = store.tasks(ALICE)
    (schedule,) = scheduler.schedules.values()
    assert schedule["ScheduleExpression"] == "rate(1440 minutes)"
    assert json.loads(schedule["Target"]["Input"]) == {"task": {"user": ALICE, "id": task["id"]}}


def test_every_action_is_audited(sentinel, store, clock):
    sentinel.run(ALICE, "browse", {"url": "https://example.com/"})
    clock.now += 1
    sentinel.run(ALICE, "rm_rf", {})
    assert [e["detail"]["name"] for e in store.audit_log(ALICE) if e["event"] == "tool"] == ["rm_rf", "browse"]


def test_unknown_action_and_errors_become_text(sentinel):
    assert sentinel.run(ALICE, "rm_rf", {}) == "Unknown action: rm_rf"
    assert sentinel.run(ALICE, "schedule_task", {"prompt": "x", "every_minutes": 0}).startswith("Error:")
    assert sentinel.run(ALICE, "browse", {"nope": 1}).startswith("Error:")


def test_auto_allow_browses_without_asking_and_audits_it(sentinel, store, browser):
    store.update_settings(ALICE, True)
    assert sentinel.run(ALICE, "browse", {"url": "https://example.com/"}) == "Example Domain"
    assert store.approvals(ALICE) == []
    assert any(e["event"] == "auto_allowed" and e["detail"]["domain"] == "example.com" for e in store.audit_log(ALICE))
    # Only for the user who turned it on.
    assert sentinel.run(BOB, "browse", {"url": "https://example.com/"}).startswith("Blocked")


def test_auto_allow_still_respects_an_explicit_denial_and_hard_refusals(sentinel, store, browser):
    store.request_domain(ALICE, "example.com")
    store.decide(ALICE, "example.com", False)
    store.update_settings(ALICE, True)
    assert "denied" in sentinel.run(ALICE, "browse", {"url": "https://example.com/"})
    assert sentinel.run(ALICE, "browse", {"url": "http://169.254.169.254/"}).startswith("Refused")
    assert browser.visited == []
