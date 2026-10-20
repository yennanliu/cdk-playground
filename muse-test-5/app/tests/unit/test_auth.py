import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from muse.auth import CognitoAuth, DevAuth
from tests.conftest import ALICE

ISSUER = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_pool"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeJwks:
    """Stands in for PyJWKClient, which would fetch the pool's public keys."""

    class Key:
        key = KEY.public_key()

    def get_signing_key_from_jwt(self, token):
        return self.Key()


def token(**overrides):
    claims = {"sub": ALICE, "iss": ISSUER, "token_use": "access", "client_id": "web", "exp": time.time() + 600}
    return jwt.encode(claims | overrides, KEY, algorithm="RS256")


@pytest.fixture
def auth():
    return CognitoAuth("ap-northeast-1", "ap-northeast-1_pool", "web", jwks=FakeJwks())


def test_accepts_an_access_token_for_this_app(auth):
    assert auth.user(token()) == ALICE


@pytest.mark.parametrize(
    "bad",
    [
        {"token_use": "id"},
        {"client_id": "other-app"},
        {"iss": "https://cognito-idp.ap-northeast-1.amazonaws.com/someone-else"},
        {"exp": time.time() - 10},
        {"sub": "../../x"},
    ],
)
def test_rejects_anything_else(auth, bad):
    with pytest.raises(jwt.InvalidTokenError):
        auth.user(token(**bad))


def test_rejects_a_forged_signature(auth):
    forged = jwt.encode({"sub": ALICE}, rsa.generate_private_key(public_exponent=65537, key_size=2048), "RS256")
    with pytest.raises(jwt.InvalidTokenError):
        auth.user(forged)


def test_dev_auth_trusts_the_sub():
    assert DevAuth().user(jwt.encode({"sub": "dev-jo"}, None, algorithm="none")) == "dev-jo"
