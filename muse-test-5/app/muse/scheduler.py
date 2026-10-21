"""Background tasks: due tasks, across all users, become queued turns for their user's sandbox."""

import logging
import threading
import time

log = logging.getLogger(__name__)


class Scheduler:
    def __init__(self, store, sandboxes, clock=time.time):
        self.store = store
        self.sandboxes = sandboxes
        self.clock = clock

    def tick(self):
        now, started = self.clock(), 0
        for task in self.store.due_tasks(now):
            if not self.store.advance_task(task, now):
                continue  # another api replica took it, or it was deleted
            user = task["user"]
            self.store.enqueue_turn(user, f"task-{task['id']}", task["prompt"], task_id=task["id"])
            try:
                self.sandboxes.ensure(user)
            except Exception:  # the turn stays queued for the next sandbox
                log.exception("could not start a sandbox for %s", user)
            started += 1
        return started

    def run_forever(self, stop, every=30):
        while not stop.is_set():
            try:
                if count := self.tick():
                    log.info("queued %d task run(s)", count)
            except Exception:  # keep ticking; one bad tick must not stop all future tasks
                log.exception("scheduler tick failed")
            stop.wait(every)

    def start(self):
        threading.Thread(target=self.run_forever, args=(threading.Event(),), daemon=True).start()
