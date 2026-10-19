"""Shared fixtures. DynamoDB is moto's; AgentCore, the scheduler and the browser are small fakes."""

import io
import json

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from muse.store import Store
from muse.tasks import Tasks

ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"


class Clock:
    def __init__(self, now=1_700_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


def not_found(op):
    return ClientError({"Error": {"Code": "ResourceNotFoundException", "Message": "not found"}}, op)


class FakeScheduler:
    def __init__(self):
        self.schedules = {}

    def create_schedule(self, **kwargs):
        self.schedules[(kwargs["GroupName"], kwargs["Name"])] = kwargs

    def delete_schedule(self, Name, GroupName):
        if self.schedules.pop((GroupName, Name), None) is None:
            raise not_found("DeleteSchedule")


class FakeBrowser:
    def __init__(self, pages=None):
        self.pages = pages or {}
        self.visited = []

    def fetch(self, url):
        self.visited.append(url)
        return self.pages.get(url, f"page at {url}")


class FakeRuntime:
    """Stands in for the bedrock-agentcore client's invoke_agent_runtime."""

    def __init__(self, reply="ok", error=None):
        self.reply = reply
        self.error = error
        self.calls = []

    def invoke_agent_runtime(self, **kwargs):
        self.calls.append({**kwargs, "payload": json.loads(kwargs["payload"])})
        if self.error:
            raise self.error
        return {"response": io.BytesIO(json.dumps({"reply": self.reply}).encode())}


@pytest.fixture
def table():
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="ap-northeast-1")
        yield ddb.create_table(
            TableName="muse",
            KeySchema=[{"AttributeName": "user", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            AttributeDefinitions=[
                {"AttributeName": "user", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def store(table, clock):
    return Store(table, clock=clock)


@pytest.fixture
def scheduler():
    return FakeScheduler()


@pytest.fixture
def tasks(store, scheduler):
    return Tasks(store, scheduler, "muse", "arn:aws:lambda:ap-northeast-1:123456789012:function:worker", "arn:role")
