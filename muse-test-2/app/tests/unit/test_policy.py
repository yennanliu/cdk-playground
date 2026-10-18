import pytest

from muse.policy import ip_refusal, url_refusal


@pytest.mark.parametrize("url", ["https://example.com/", "http://example.com:8080/a?b=1"])
def test_ok_urls(url):
    assert url_refusal(url) is None


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.com/", "javascript:alert(1)", "not a url", ""])
def test_bad_urls(url):
    assert url_refusal(url)


@pytest.mark.parametrize("ip", ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"])
def test_public_ips_ok(ip):
    assert ip_refusal(ip) is None


@pytest.mark.parametrize(
    "ip", ["10.0.0.5", "172.18.0.2", "192.168.1.1", "127.0.0.1", "::1", "0.0.0.0", "fd00:ec2::254"]
)
def test_private_ips_refused_by_default(ip):
    assert ip_refusal(ip)
    assert ip_refusal(ip, allow_private=True) is None


@pytest.mark.parametrize("ip", ["169.254.169.254", "fe80::1"])
def test_link_local_always_refused(ip):
    # Instance metadata lives here: reaching it would leak the host's AWS credentials.
    assert ip_refusal(ip, allow_private=True)
