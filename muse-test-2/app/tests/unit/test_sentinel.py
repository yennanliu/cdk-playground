"""The sentinel's decision, with DNS faked."""

import asyncio

import pytest

from muse.sentinel import Sentinel

pytestmark = pytest.mark.postgres


class Resolver:
    def __init__(self, table):
        self.table = table

    async def resolve(self, host, port):
        return self.table[host]


def decide(sentinel, host, port=443):
    return asyncio.run(sentinel.decide(host, port))


@pytest.fixture
def approved(store):
    for domain in ["example.com", "rebind.example.org", "meta.example.org"]:
        store.decide(store.request_domain(domain), approve=True)
    return store


def make(store, allow_private=False):
    table = {
        "example.com": ["93.184.215.14"],
        "rebind.example.org": ["10.0.0.7"],
        "meta.example.org": ["169.254.169.254"],
        "unknown.com": ["93.184.215.15"],
    }
    return Sentinel(store, allow_private=allow_private, resolver=Resolver(table))


def test_approved_public_host_is_allowed(approved):
    assert decide(make(approved), "example.com") == ("93.184.215.14", None)


def test_unapproved_host_is_blocked_without_resolving_or_requesting(approved):
    ip, reason = decide(make(approved), "unknown.com")
    assert ip is None and "not approved" in reason
    assert {a["domain"] for a in approved.approvals()} == {"example.com", "rebind.example.org", "meta.example.org"}


def test_approved_name_resolving_to_private_ip_is_blocked(approved):
    # DNS rebinding: an approved name must not become a door into the VPC.
    ip, reason = decide(make(approved), "rebind.example.org")
    assert ip is None and "10.0.0.7" in reason


def test_metadata_is_blocked_even_when_private_is_allowed(approved):
    ip, reason = decide(make(approved, allow_private=True), "meta.example.org")
    assert ip is None and "link-local" in reason


def test_only_web_ports(approved):
    ip, reason = decide(make(approved), "example.com", port=22)
    assert ip is None and "port" in reason


def test_blocks_are_audited(approved):
    decide(make(approved), "unknown.com")
    entry = approved.audit_log()[0]
    assert entry["event"] == "egress_blocked" and entry["detail"]["host"] == "unknown.com"
