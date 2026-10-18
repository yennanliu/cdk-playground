"""The tools the model may call, and the sentinel that guards `browse`."""

import ipaddress
import time
from urllib.parse import urlparse


def _spec(name, description, properties, required):
    schema = {"type": "object", "properties": properties, "required": required}
    return {"toolSpec": {"name": name, "description": description, "inputSchema": {"json": schema}}}


SPECS = [
    _spec(
        "remember",
        "Save a durable fact about the user (preferences, people, plans). Use whenever they share one.",
        {"text": {"type": "string"}},
        ["text"],
    ),
    _spec(
        "recall",
        "Search saved memories by keywords. An empty query lists all.",
        {"query": {"type": "string"}},
        ["query"],
    ),
    _spec("forget", "Delete a saved memory by id.", {"id": {"type": "integer"}}, ["id"]),
    _spec(
        "browse",
        "Open a web page in a real browser and return its text. Unapproved domains need the user's approval.",
        {"url": {"type": "string"}},
        ["url"],
    ),
    _spec(
        "schedule_task",
        "Run a prompt in the background on a fixed interval, e.g. a daily summary.",
        {"prompt": {"type": "string"}, "every_minutes": {"type": "integer", "minimum": 1}},
        ["prompt", "every_minutes"],
    ),
]
NAMES = {s["toolSpec"]["name"] for s in SPECS}


class Toolbox:
    def __init__(self, store, browser, clock=time.time, allow_private=False):
        self.store = store
        self.browser = browser
        self.clock = clock
        self.allow_private = allow_private

    def specs(self):
        return SPECS

    def run(self, name, args):
        self.store.audit("tool", {"name": name, "input": args})
        if name not in NAMES:
            return f"Unknown tool: {name}"
        try:
            return getattr(self, f"_{name}")(**args)
        except Exception as e:  # noqa: BLE001 -- a failed tool is information for the model, not a crash
            return f"Error: {e}"

    def _remember(self, text):
        return f"Saved memory #{self.store.remember(text)}."

    def _recall(self, query):
        found = self.store.recall(query)
        return "\n".join(f"#{m['id']}: {m['text']}" for m in found) or "No matching memories."

    def _forget(self, id):
        return f"Forgot memory #{id}." if self.store.forget(id) else f"No memory #{id}."

    def _schedule_task(self, prompt, every_minutes):
        task_id = self.store.add_task(prompt, int(every_minutes), now=self.clock())
        return f"Scheduled task #{task_id} every {every_minutes} minutes."

    def _browse(self, url):
        refusal = self._refuse(url)
        if refusal:
            return f"Refused: {refusal}"
        host = urlparse(url).hostname
        if not self.store.is_allowed(host):
            approval = self.store.request_domain(host)
            return (
                f"Blocked: {host} is not approved yet. Approval request #{approval} was sent to the user; "
                "ask them to approve it, then try again."
            )
        return self.browser.fetch(url)

    def _refuse(self, url):
        """Requests the sentinel never sends, approval or not."""
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return "only http(s) URLs can be browsed"
        try:
            ip = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            ip = None
        if ip and ip.is_link_local:  # instance metadata: would leak the host's AWS credentials
            return "link-local addresses are never browsed"
        if not self.allow_private and (parsed.hostname == "localhost" or (ip and (ip.is_private or ip.is_loopback))):
            return "private and loopback addresses are not browsed"
        return None
