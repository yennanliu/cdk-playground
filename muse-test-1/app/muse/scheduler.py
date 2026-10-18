import logging
import threading
import time

log = logging.getLogger(__name__)


class Scheduler:
    """Runs due background tasks through the agent, on a daemon thread."""

    def __init__(self, store, agent, interval=30):
        self.store = store
        self.agent = agent
        self.interval = interval
        self._stop = threading.Event()
        self._thread = None

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def tick(self, now=None):
        now = time.time() if now is None else now
        due = self.store.due_tasks(now)
        for task in due:
            try:
                result = self.agent.run_task(task["prompt"])
            except Exception as e:  # noqa: BLE001 -- recorded on the task; the next tasks still run
                result = f"Failed: {e}"
                self.store.audit("task_failed", {"task": task["id"], "error": str(e)})
            self.store.finish_task(task["id"], result, now)
        return len(due)

    def start(self):
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="muse-scheduler", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self):
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:  # keep the loop alive; one bad tick must not stop all future tasks
                log.exception("scheduler tick failed")
            self._stop.wait(self.interval)
