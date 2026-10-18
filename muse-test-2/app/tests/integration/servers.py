"""Local servers for integration tests: a web page, a TCP echo, and the sentinel."""

import asyncio
import contextlib
import http.server
import socket
import socketserver
import threading

from muse.sentinel import Sentinel

PAGE = (
    b"<html><head><title>Recipes</title><script>document.write('<p>from js</p>')</script></head>"
    b"<body><h1>Pancakes</h1><p>Flour, eggs, milk.</p></body></html>"
)


@contextlib.contextmanager
def web_server():
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(PAGE)))
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield server.server_port
    finally:
        server.shutdown()


@contextlib.contextmanager
def echo_server():
    class Echo(socketserver.BaseRequestHandler):
        def handle(self):
            while data := self.request.recv(1024):
                self.request.sendall(data)

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Echo)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()


@contextlib.contextmanager
def sentinel_server(store, allow_private=True):
    """Run the real sentinel on its own event loop thread; yields its port."""
    loop = asyncio.new_event_loop()
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    sentinel = Sentinel(store, allow_private=allow_private)
    started = threading.Event()

    def run():
        asyncio.set_event_loop(loop)
        server = loop.run_until_complete(asyncio.start_server(sentinel.handle, "127.0.0.1", port))
        started.set()
        try:
            loop.run_forever()
        finally:
            server.close()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    started.wait(5)
    try:
        yield port
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(5)
