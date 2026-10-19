"""The sentinel Lambda: the only way the agent can act on the world.

The AgentCore Runtime role may invoke this function and nothing else that acts:
it cannot start a browser, write the table or create schedules. So every action
passes through here, is audited, and is checked against the user's approvals.
The user ID comes from the runtime's code (taken from the verified JWT upstream),
never from the model.
"""

import functools
import ipaddress
import os
from urllib.parse import urlparse

from muse.config import Config


def refusal(url):
    """Why a URL is never browsed, approval or not; None if it may be."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return "only http(s) URLs can be browsed"
    try:
        ip = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        ip = None
    if parsed.hostname == "localhost" or (ip and (ip.is_private or ip.is_loopback or ip.is_link_local)):
        return "private, loopback and link-local addresses are never browsed"
    return None


def domain_allowed(host, allowed):
    host = host.lower()
    return any(host == d or host.endswith("." + d) for d in allowed)


class Sentinel:
    def __init__(self, store, browser, tasks, allowed_domains=()):
        self.store = store
        self.browser = browser
        self.tasks = tasks
        self.seeded = {d.lower() for d in allowed_domains}

    def run(self, user, action, args):
        self.store.audit(user, "tool", {"name": action, "input": args})
        handler = {"browse": self._browse, "schedule_task": self._schedule_task}.get(action)
        if not handler:
            return f"Unknown action: {action}"
        try:
            return handler(user, **args)
        except Exception as e:  # noqa: BLE001 -- a failed action is information for the model, not a crash
            return f"Error: {e}"

    def _browse(self, user, url):
        if reason := refusal(url):
            self.store.audit(user, "refused", {"url": url, "reason": reason})
            return f"Refused: {reason}"
        host = urlparse(url).hostname.lower()
        if not domain_allowed(host, self.seeded | self.store.approved_domains(user)):
            approval = self.store.request_domain(user, host)
            if approval["status"] == "denied":
                return f"Blocked: the user denied access to {host}. Do not try again."
            return (
                f"Blocked: {host} is not approved yet. An approval request was sent to the user; "
                "ask them to approve it, then try again."
            )
        return self.browser.fetch(url)

    def _schedule_task(self, user, prompt, every_minutes):
        task_id = self.tasks.add(user, prompt, every_minutes)
        return f"Scheduled task {task_id} every {every_minutes} minutes."


@functools.cache
def _sentinel():
    import boto3

    from muse.browser import Browser
    from muse.store import Store
    from muse.tasks import Tasks

    config = Config.from_env(os.environ)
    store = Store(boto3.resource("dynamodb").Table(config.table))
    tasks = Tasks(store, boto3.client("scheduler"), config.schedule_group, config.worker_arn, config.scheduler_role_arn)
    return Sentinel(store, Browser(config.region), tasks, config.allowed_domains)


def handler(event, _context):
    """Event: {"user": <sub>, "action": "browse" | "schedule_task", "input": {...}}."""
    return {"result": _sentinel().run(event["user"], event["action"], event["input"])}
