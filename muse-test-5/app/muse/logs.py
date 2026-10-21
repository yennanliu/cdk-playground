"""Logging setup: keep the access log for real requests, not routine polling."""

import logging


def setup(skip=lambda path, status: False):
    """`skip(path, status)` names access-log lines not worth keeping; health checks never are."""
    logging.basicConfig(level=logging.INFO)

    def keep(record):
        _, _, path, _, status = record.args
        return path != "/health" and not skip(path, status)

    logging.getLogger("uvicorn.access").addFilter(keep)
