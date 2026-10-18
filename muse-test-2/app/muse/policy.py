"""Egress rules shared by the worker (to explain) and the sentinel (to enforce)."""

import ipaddress
from urllib.parse import urlparse


def url_refusal(url):
    """Why a URL can never be browsed, or None."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return "malformed URL"
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return "only http(s) URLs can be browsed"
    return None


def ip_refusal(ip, allow_private=False):
    """Why an address must never be connected to, or None."""
    addr = ipaddress.ip_address(ip)
    if addr.is_link_local:  # instance metadata: would leak the host's AWS credentials
        return f"{ip} is link-local"
    if not allow_private and (
        addr.is_private or addr.is_loopback or addr.is_unspecified or addr.is_reserved or addr.is_multicast
    ):
        return f"{ip} is not a public address"
    return None
