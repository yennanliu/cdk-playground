import json

import pytest

from muse.tasks import Tasks
from tests.conftest import ALICE


def test_add_creates_a_rate_schedule_targeting_the_worker(tasks, scheduler):
    task_id = tasks.add(ALICE, "ping", 1)
    schedule = scheduler.schedules[("muse", Tasks.schedule_name(ALICE, task_id))]
    assert schedule["ScheduleExpression"] == "rate(1 minute)"
    assert schedule["Target"]["Arn"].endswith(":function:worker")
    assert schedule["Target"]["RetryPolicy"] == {"MaximumRetryAttempts": 0}
    assert json.loads(schedule["Target"]["Input"]) == {"task": {"user": ALICE, "id": task_id}}


def test_schedule_name_fits_the_64_char_limit():
    assert len(Tasks.schedule_name(ALICE, "abcdef012345")) <= 64


def test_rejects_non_positive_interval(tasks, store):
    with pytest.raises(ValueError):
        tasks.add(ALICE, "ping", 0)
    assert store.tasks(ALICE) == []


def test_delete_removes_both_and_tolerates_a_missing_schedule(tasks, scheduler, store):
    task_id = tasks.add(ALICE, "ping", 5)
    scheduler.schedules.clear()
    assert tasks.delete(ALICE, task_id)
    assert store.tasks(ALICE) == []
    assert not tasks.delete(ALICE, task_id)
