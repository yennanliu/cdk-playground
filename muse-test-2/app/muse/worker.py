"""Agent worker: takes jobs off the Postgres queue and runs them. Run as many as you like."""

import logging
import os
import signal
import threading

log = logging.getLogger(__name__)


class Worker:
    def __init__(self, store, agent):
        self.store = store
        self.agent = agent

    def run_once(self):
        """Run one job if there is one. Returns whether a job was run."""
        job = self.store.claim()
        if job is None:
            return False
        try:
            if job["kind"] == "chat":
                result = self.agent.chat(job["session"], job["input"])
            else:
                result = self.agent.run_task(job["input"])
            self.store.finish(job["id"], result)
        except Exception as e:  # recorded on the job; the worker keeps serving
            log.exception("job %s failed", job["id"])
            self.store.audit("job_failed", {"job": job["id"], "error": str(e)})
            self.store.finish(job["id"], f"Failed: {e}", ok=False)
        return True

    def run_forever(self, stop, idle_wait=5):
        while not stop.is_set():
            if not self.run_once():
                self.store.wait_for_jobs(timeout=idle_wait)


def main():
    from muse.agent import Agent
    from muse.browser import BrowserClient
    from muse.config import Config
    from muse.llm import Bedrock, Embedder
    from muse.store import Store
    from muse.tools import Toolbox

    logging.basicConfig(level=logging.INFO)
    config = Config.from_env(os.environ)
    store = Store(config.database_url, allowed_domains=config.allowed_domains)
    embedder = Embedder(config.embed_model_id, region=config.region)
    tools = Toolbox(store, BrowserClient(config.browser_url), embedder, allow_private=config.allow_private)
    agent = Agent(Bedrock(config.model_id, region=config.region), tools, store, embedder)

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    log.info("worker ready")
    Worker(store, agent).run_forever(stop)


if __name__ == "__main__":
    main()
