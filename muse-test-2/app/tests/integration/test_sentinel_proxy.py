"""The real sentinel proxying real HTTP and CONNECT traffic."""

import socket

import httpx
import pytest

from tests.integration.servers import echo_server, sentinel_server, web_server

pytestmark = pytest.mark.postgres


def approve(store, domain):
    store.decide(store.request_domain(domain), approve=True)


def connect(proxy_port, target):
    sock = socket.create_connection(("127.0.0.1", proxy_port), timeout=5)
    sock.sendall(f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode())
    return sock, sock.recv(4096).decode()


def test_http_to_approved_host_is_forwarded(store):
    approve(store, "localhost")
    with web_server() as web, sentinel_server(store) as proxy:
        r = httpx.get(f"http://localhost:{web}/", proxy=f"http://127.0.0.1:{proxy}")
    assert r.status_code == 200 and b"Pancakes" in r.content


def test_http_to_unapproved_host_is_403(store):
    with web_server() as web, sentinel_server(store) as proxy:
        r = httpx.get(f"http://localhost:{web}/", proxy=f"http://127.0.0.1:{proxy}")
    assert r.status_code == 403 and "not approved" in r.text


def test_connect_tunnel_to_approved_host(store):
    approve(store, "localhost")
    with echo_server() as echo, sentinel_server(store) as proxy:
        sock, status = connect(proxy, f"localhost:{echo}")
        assert status.startswith("HTTP/1.1 200")
        sock.sendall(b"hello through the tunnel")
        assert sock.recv(1024) == b"hello through the tunnel"
        sock.close()


def test_connect_to_unapproved_host_is_403(store):
    with echo_server() as echo, sentinel_server(store) as proxy:
        sock, status = connect(proxy, f"localhost:{echo}")
        sock.close()
    assert status.startswith("HTTP/1.1 403")


def test_production_mode_never_reaches_local_servers(store):
    # Even approved, a local server is refused (by its port and its address; unit tests cover each rule).
    approve(store, "localhost")
    with web_server() as web, sentinel_server(store, allow_private=False) as proxy:
        r = httpx.get(f"http://localhost:{web}/", proxy=f"http://127.0.0.1:{proxy}")
    assert r.status_code == 403 and "Blocked by Muse sentinel" in r.text


def test_garbage_request_does_not_kill_the_proxy(store):
    approve(store, "localhost")
    with web_server() as web, sentinel_server(store) as proxy:
        with socket.create_connection(("127.0.0.1", proxy), timeout=5) as sock:
            sock.sendall(b"\x16\x03\x01 not http\r\n\r\n")
            assert sock.recv(1024).startswith(b"HTTP/1.1 400")
        r = httpx.get(f"http://localhost:{web}/", proxy=f"http://127.0.0.1:{proxy}")
    assert r.status_code == 200
