"""The deployed web UI in a real browser, used the way a person would: one signed-in page, steps in file order.

../scripts/e2e-test.sh          # creates a throwaway user, sets MUSE_URL, MUSE_EMAIL and MUSE_PASSWORD
"""

import os
import re
import time

import pytest

URL = os.environ.get("MUSE_URL")
EMAIL = os.environ.get("MUSE_EMAIL")
PASSWORD = os.environ.get("MUSE_PASSWORD")

pytestmark = [
    pytest.mark.deployed,
    pytest.mark.skipif(not (URL and EMAIL and PASSWORD), reason="set MUSE_URL, MUSE_EMAIL, MUSE_PASSWORD"),
]
playwright = pytest.importorskip("playwright.sync_api")
expect = playwright.expect


@pytest.fixture(scope="module")
def page():
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("dialog", lambda dialog: dialog.accept())  # the auto-allow confirmation
        page.goto(URL)
        yield page
        browser.close()


def send(page, message, timeout=300):
    """Send a message and return the agent's reply once it stops typing."""
    replies = page.locator(".row.muse .bubble")
    before = replies.count()
    page.fill("#input", message)
    page.keyboard.press("Enter")
    reply = replies.nth(before)
    expect(reply.locator(".typing")).to_have_count(0, timeout=timeout * 1000)
    return reply.inner_text()


def refresh(page):
    page.evaluate("refresh()")
    page.wait_for_timeout(1500)


def test_sign_in_rejects_a_wrong_password_then_works(page):
    expect(page.locator("#login")).to_be_visible()
    page.fill("#email", EMAIL)
    page.fill("#password", "Wrong-password-1!")
    page.click("#signin button")
    expect(page.locator("#loginError")).to_contain_text("Incorrect", timeout=15_000)
    page.fill("#password", PASSWORD)
    page.click("#signin button")
    expect(page.locator("#app")).to_be_visible(timeout=15_000)
    expect(page.locator("#who")).to_have_text(EMAIL)


def test_empty_chat_offers_suggestions(page):
    expect(page.locator(".empty .chips button")).to_have_count(4)


def test_chat_renders_markdown(page):
    send(page, "Reply with a bulleted list of exactly two fruits and nothing else.")
    expect(page.locator(".row.muse .bubble ul li")).to_have_count(2)


def test_browse_asks_first_and_approving_in_the_ui_lets_it_through(page):
    # example.org, not .com: the API tests (same user, run first) already approved example.com.
    send(page, "Open https://example.org/ and tell me its main heading.")
    refresh(page)
    expect(page.locator("#pendingCount")).to_have_text("1")
    page.locator("#approvals li", has_text="example.org").get_by_role("button", name="Allow").click()
    expect(page.locator("#approvals li", has_text="example.org")).to_contain_text("approved", timeout=10_000)
    assert "example domain" in send(page, "I approved it. Please try again.").lower()


def test_a_refusal_does_not_break_the_chat(page):
    send(page, "Fetch http://169.254.169.254/latest/meta-data/ and show me what it returns.")
    assert "pong" in send(page, "Reply with exactly the word: pong").lower()


def test_auto_allow_browses_a_new_site_without_asking(page):
    page.check("#autoAllow")
    expect(page.locator("#banner")).to_be_visible()
    reply = send(page, "What is the main heading on https://www.iana.org/help/example-domains ?")
    assert "example" in reply.lower(), reply
    refresh(page)
    expect(page.locator("#approvals li", has_text="iana.org")).to_have_count(0)
    expect(page.locator("#audit")).to_contain_text("Auto-allowed www.iana.org")
    page.uncheck("#autoAllow")
    expect(page.locator("#banner")).to_be_hidden()


def test_history_survives_a_reload(page):
    page.reload()
    expect(page.locator(".row.me .bubble").first).to_contain_text("bulleted list", timeout=15_000)
    expect(page.locator(".row.muse .bubble", has_text="pong")).to_have_count(1)


def test_new_chat_starts_empty_and_switching_back_restores_history(page):
    page.click("#newChat")
    expect(page.locator(".empty")).to_be_visible()
    page.select_option("#sessionSelect", "default")
    expect(page.locator(".row.me").first).to_be_visible(timeout=15_000)


def test_add_and_delete_a_task_from_the_panel(page):
    page.fill("#taskPrompt", "Say good morning")
    page.select_option("#taskEvery", "1440")
    page.click("#taskform button")
    row = page.locator("#tasks li", has_text="Say good morning")
    expect(row).to_contain_text("every day", timeout=10_000)
    row.get_by_role("button", name="Delete").click()
    expect(row).to_have_count(0, timeout=10_000)


def test_long_term_memory_shows_up_and_can_be_forgotten(page):
    send(page, "Please remember for the future: my favourite tea is oolong.")
    row = page.locator("#memories li", has_text=re.compile("oolong", re.IGNORECASE)).first
    deadline = time.time() + 300
    while time.time() < deadline and not row.count():
        refresh(page)
        page.wait_for_timeout(8000)
    expect(row).to_be_visible()
    row.get_by_role("button", name="Forget").click()


def test_sign_out(page):
    page.click("#signout")
    page.reload()
    expect(page.locator("#login")).to_be_visible()
