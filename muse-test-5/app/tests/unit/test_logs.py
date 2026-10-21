import logging

import pytest

from muse import logs


@pytest.fixture
def access():
    logger = logging.getLogger("uvicorn.access")
    yield lambda path, status: all(
        f(logging.makeLogRecord({"args": ("1.2.3.4:5", "POST", path, "1.1", status)})) for f in logger.filters
    )
    logger.filters.clear()


def test_health_checks_are_never_logged(access):
    logs.setup()
    assert not access("/health", 200)
    assert access("/chat", 202)


def test_routine_polling_is_dropped_but_work_is_kept(access):
    logs.setup(lambda path, status: status == 204 and path in ("/heartbeat", "/next"))
    assert not access("/heartbeat", 204) and not access("/next", 204)
    assert access("/next", 200) and access("/heartbeat", 409) and access("/permit", 200)
