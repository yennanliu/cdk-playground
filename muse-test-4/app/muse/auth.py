"""Who is calling the api: the `sub` of a Cognito access token."""

import re

import jwt

USER = re.compile(r"^[A-Za-z0-9-]{1,64}$")  # a Cognito sub is a UUID; dev users are `dev-<name>`


class CognitoAuth:
    def __init__(self, region, user_pool_id, client_id, jwks=None):
        self.issuer = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"
        self.client_id = client_id
        self.jwks = jwks or jwt.PyJWKClient(f"{self.issuer}/.well-known/jwks.json")

    def user(self, token):
        key = self.jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=self.issuer,
            options={"require": ["exp", "sub", "token_use", "client_id"]},
        )
        if claims["token_use"] != "access" or claims["client_id"] != self.client_id:
            raise jwt.InvalidTokenError("not an access token for this app")
        return _checked(claims["sub"])


class DevAuth:
    """Local runs only: trusts the token's `sub` without checking a signature (the page makes one up)."""

    def user(self, token):
        return _checked(jwt.decode(token, options={"verify_signature": False})["sub"])


def _checked(sub):
    if not USER.match(sub):
        raise jwt.InvalidTokenError("unexpected sub")
    return sub
