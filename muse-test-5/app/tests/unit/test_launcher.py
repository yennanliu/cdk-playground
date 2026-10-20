import json

import httpx

from muse.sandboxes import KubeLauncher

TEMPLATE = {
    "apiVersion": "batch/v1",
    "kind": "Job",
    "spec": {"template": {"spec": {"runtimeClassName": "gvisor", "containers": [{"name": "sandbox", "env": []}]}}},
}


def launcher(seen):
    def handler(request):
        seen.append((request.method, request.url.path, request.url.params.get("propagationPolicy"), request.content))
        return httpx.Response(201, json={"metadata": {"name": "sandbox-x7k2p"}})

    return KubeLauncher(
        "sandboxes", TEMPLATE, client=httpx.Client(base_url="https://kube", transport=httpx.MockTransport(handler))
    )


def test_launch_creates_a_job_from_the_template_with_the_token():
    seen = []
    assert launcher(seen).launch("alice", "alice.secret") == "sandbox-x7k2p"
    method, path, _, body = seen[0]
    job = json.loads(body)
    assert (method, path) == ("POST", "/apis/batch/v1/namespaces/sandboxes/jobs")
    assert job["metadata"] == {"generateName": "sandbox-", "labels": {"muse/user": "alice"}}
    pod = job["spec"]["template"]
    assert pod["metadata"]["labels"] == {"muse/user": "alice"} and pod["spec"]["runtimeClassName"] == "gvisor"
    assert pod["spec"]["containers"][0]["env"] == [{"name": "MUSE_TOKEN", "value": "alice.secret"}]
    assert TEMPLATE["spec"]["template"]["spec"]["containers"][0]["env"] == []  # the template is never changed


def test_stop_deletes_the_job_and_its_pod():
    seen = []
    launcher(seen).stop("sandbox-x7k2p")
    assert seen[0][:3] == ("DELETE", "/apis/batch/v1/namespaces/sandboxes/jobs/sandbox-x7k2p", "Background")
