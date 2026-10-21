import json

import httpx
import pytest

from muse.sandbox import Gateway, Runner, with_credentials


class FakeGateway:
    def __init__(self, turns=(), stay_once=False):
        self.turns = list(turns)
        self.stay_once = stay_once
        self.finished = []
        self.sign_offs = 0

    def next_turn(self):
        return self.turns.pop(0) if self.turns else None

    def finish(self, turn_id, reply, ok, messages):
        self.finished.append((turn_id, reply, ok, messages))

    def sign_off(self):
        self.sign_offs += 1
        if self.stay_once and self.sign_offs == 1:
            self.turns.append({"id": "late"})
            return False
        return True


class EchoAgent:
    def run(self, turn):
        if turn["id"] == "boom":
            raise RuntimeError("model down")
        return f"re: {turn['id']}", ["kept"]


def test_runs_turns_then_stops_when_idle():
    gateway = FakeGateway([{"id": "a"}, {"id": "boom"}])
    Runner(gateway, EchoAgent(), idle_seconds=0).run()
    assert gateway.finished == [("a", "re: a", True, ["kept"]), ("boom", "The agent failed: model down", False, None)]


def test_stays_when_work_arrives_while_signing_off():
    gateway = FakeGateway(stay_once=True)
    Runner(gateway, EchoAgent(), idle_seconds=0).run()
    assert [f[0] for f in gateway.finished] == ["late"] and gateway.sign_offs == 2


def test_waits_out_the_idle_time():
    now = [0.0]

    class Ticking(FakeGateway):
        def next_turn(self):
            now[0] += 20  # each empty long poll takes 20 s
            return super().next_turn()

    gateway = Ticking()
    Runner(gateway, EchoAgent(), idle_seconds=60, clock=lambda: now[0]).run()
    assert now[0] == 60 and gateway.sign_offs == 1


def test_gateway_client_speaks_the_sentinel_protocol():
    seen = []

    def handler(request):
        seen.append((request.url.path, request.headers["authorization"], json.loads(request.content or b"{}")))
        return {
            "/next": httpx.Response(204),
            "/permit": httpx.Response(200, json={"reason": None}),
            "/act": httpx.Response(200, json={"result": "Saved"}),
            "/bye": httpx.Response(200, json={"stopped": True}),
        }.get(request.url.path, httpx.Response(204))

    client = httpx.Client(
        base_url="http://sentinel:8081", transport=httpx.MockTransport(handler), headers={"Authorization": "Bearer u.s"}
    )
    gateway = Gateway("unused", "u.s", client=client)
    assert gateway.next_turn() is None
    assert gateway.permit("https://a.com") is None
    assert gateway.act("remember", {"text": "x"}) == "Saved"
    assert gateway.sign_off() is True
    gateway.finish("t1", "hi", True, None)
    assert seen[-1] == ("/turns/t1", "Bearer u.s", {"reply": "hi", "ok": True, "messages": None})


def test_gateway_client_raises_when_locked_out():
    client = httpx.Client(base_url="http://sentinel:8081", transport=httpx.MockTransport(lambda r: httpx.Response(401)))
    with pytest.raises(httpx.HTTPStatusError):
        Gateway("unused", "u.s", client=client).next_turn()


def test_proxy_url_carries_the_token():
    assert with_credentials("http://sentinel:3128", "dev-jo.a_b-c") == "http://muse:dev-jo.a_b-c@sentinel:3128"
