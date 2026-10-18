"""Scheduler: turns due tasks into jobs and rescues jobs from dead workers.
It never runs the agent itself, so it needs no AWS access and no internet."""

import logging
import os
import signal
import threading
import time

log = logging.getLogger(__name__)


class Scheduler:
    def __init__(self, store, stale_after=900):
        self.store = store
        self.stale_after = stale_after

    def tick(self, now=None):
        now = time.time() if now is None else now
        self.store.requeue_stale(older_than=now - self.stale_after)
        return self.store.enqueue_due_tasks(now)


def main():
    from muse.config import Config
    from muse.store import Store

    logging.basicConfig(level=logging.INFO)
    config = Config.from_env(os.environ)
    scheduler = Scheduler(Store(config.database_url))

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    log.info("scheduler ready")
    while not stop.is_set():
        try:
            if count := scheduler.tick():
                log.info("enqueued %d task(s)", count)
        except Exception:  # keep ticking; one bad tick must not stop all future tasks
            log.exception("scheduler tick failed")
        stop.wait(config.scheduler_seconds)


if __name__ == "__main__":
    main()
