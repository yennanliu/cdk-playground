"""Sentinel: the browser's only route to the internet.

An HTTP forward proxy (CONNECT for https, absolute-URI requests for http). It
lets a connection through only if the domain is approved, the port is a web
port, and every address the name resolves to is public. It connects to the
address it checked, so DNS rebinding cannot swap in an internal one. The
browser's networks have no other way out, so these rules hold even if the
agent or the page is compromised.
"""

import asyncio
import contextlib
import logging
import os
import socket
from http import HTTPStatus
from urllib.parse import urlsplit

from muse.policy import ip_refusal

log = logging.getLogger(__name__)
WEB_PORTS = {80, 443}


class DnsResolver:
    async def resolve(self, host, port):
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
        return list(dict.fromkeys(info[4][0] for info in infos))


class Sentinel:
    def __init__(self, store, allow_private=False, resolver=None):
        self.store = store
        self.allow_private = allow_private
        self.resolver = resolver or DnsResolver()

    async def decide(self, host, port):
        """Returns (ip to connect to, None) or (None, why not)."""
        if port not in WEB_PORTS and not self.allow_private:
            return await self._block(host, port, f"port {port} is not a web port")
        if not await asyncio.to_thread(self.store.is_allowed, host):
            return await self._block(host, port, "is not approved; ask Muse to browse it to request approval")
        try:
            ips = await self.resolver.resolve(host, port)
        except OSError as e:
            return await self._block(host, port, f"does not resolve ({e})")
        for ip in ips:
            if refusal := ip_refusal(ip, self.allow_private):
                return await self._block(host, port, f"resolves to {refusal}")
        return ips[0], None

    async def _block(self, host, port, reason):
        await asyncio.to_thread(self.store.audit, "egress_blocked", {"host": host, "port": port, "reason": reason})
        return None, f"{host}:{port} {reason}"

    async def handle(self, reader, writer):
        try:
            await self._handle(reader, writer)
        except Exception:  # one bad connection must never take the proxy down
            log.exception("proxy connection failed")
        finally:
            with contextlib.suppress(Exception):
                writer.close()

    async def _handle(self, reader, writer):
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 30)
            method, target, version = head.split(b"\r\n", 1)[0].decode("latin-1").split(" ")
            if method == "CONNECT":
                host, _, port = target.rpartition(":")
                host, port, url = host.strip("[]"), int(port), None
            else:
                url = urlsplit(target)
                if url.scheme != "http" or not url.hostname:
                    raise ValueError(target)
                host, port = url.hostname, url.port or 80
        except (ValueError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError):
            return await _respond(writer, HTTPStatus.BAD_REQUEST, "not a proxy request")

        ip, reason = await self.decide(host, port)
        if reason:
            return await _respond(writer, HTTPStatus.FORBIDDEN, f"Blocked by Muse sentinel: {reason}")

        upstream_reader, upstream_writer = await asyncio.wait_for(asyncio.open_connection(ip, port), 10)
        if url is None:
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        else:
            upstream_writer.write(_origin_form(head, method, url, version))
        await asyncio.gather(_pipe(reader, upstream_writer), _pipe(upstream_reader, writer))

    async def serve(self, host="0.0.0.0", port=3128):
        server = await asyncio.start_server(self.handle, host, port)
        log.info("sentinel listening on %s:%d (allow_private=%s)", host, port, self.allow_private)
        async with server:
            await server.serve_forever()


def _origin_form(head, method, url, version):
    """Rewrite a proxy request for the origin server: path-only target, no proxy headers, one request."""
    path = (url.path or "/") + (f"?{url.query}" if url.query else "")
    headers = [
        line
        for line in head.decode("latin-1").split("\r\n")[1:]
        if line and not line.lower().startswith(("proxy-", "connection:"))
    ]
    return "\r\n".join([f"{method} {path} {version}", *headers, "Connection: close", "", ""]).encode("latin-1")


async def _pipe(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except ConnectionError:
        pass
    finally:
        with contextlib.suppress(Exception):
            writer.close()


async def _respond(writer, status, message):
    body = (message + "\n").encode()
    writer.write(
        f"HTTP/1.1 {status.value} {status.phrase}\r\nContent-Type: text/plain\r\n"
        f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
        + body
    )
    await writer.drain()


def main():
    from muse.config import Config
    from muse.store import Store

    logging.basicConfig(level=logging.INFO)
    config = Config.from_env(os.environ)
    store = Store(config.database_url, allowed_domains=config.allowed_domains)
    asyncio.run(Sentinel(store, allow_private=config.allow_private).serve())


if __name__ == "__main__":
    main()
