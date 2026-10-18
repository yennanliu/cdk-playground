"""All shared state in Postgres: memories (pgvector), chat history, the job queue,
tasks, domain approvals and the audit trail. Every service talks to it; none talk
to each other except worker -> browser -> sentinel."""

import json
import threading
import time

import psycopg
from psycopg.rows import dict_row

DIMENSIONS = 512
CHANNEL = "muse_jobs"
_EPOCH = "extract(epoch from now())"

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS memories (
    id serial PRIMARY KEY, text text NOT NULL, embedding vector({DIMENSIONS}) NOT NULL,
    created double precision NOT NULL DEFAULT {_EPOCH});
CREATE TABLE IF NOT EXISTS history (session text PRIMARY KEY, messages jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
    id serial PRIMARY KEY, prompt text NOT NULL, every_minutes int NOT NULL CHECK (every_minutes > 0),
    next_run double precision NOT NULL, last_result text);
CREATE TABLE IF NOT EXISTS jobs (
    id serial PRIMARY KEY, kind text NOT NULL, input text NOT NULL, session text,
    task_id int REFERENCES tasks ON DELETE SET NULL, status text NOT NULL DEFAULT 'queued', result text,
    created double precision NOT NULL DEFAULT {_EPOCH}, started double precision, finished double precision);
CREATE INDEX IF NOT EXISTS jobs_queued ON jobs (id) WHERE status = 'queued';
CREATE TABLE IF NOT EXISTS approvals (
    id serial PRIMARY KEY, domain text NOT NULL, status text NOT NULL DEFAULT 'pending',
    created double precision NOT NULL DEFAULT {_EPOCH});
CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending ON approvals (domain) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS audit (
    id serial PRIMARY KEY, at double precision NOT NULL DEFAULT {_EPOCH}, event text NOT NULL, detail jsonb NOT NULL);
"""


def _vector(values):
    return "[" + ",".join(f"{v:.7g}" for v in values) + "]"


class Store:
    def __init__(self, url, allowed_domains=()):
        self.url = url
        self._seeded = {d.lower() for d in allowed_domains}
        self._lock = threading.Lock()
        self._conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)
        self._listener = None
        with self._conn.transaction():
            # Every service starts at once on a fresh box; serialize the DDL.
            self._conn.execute("SELECT pg_advisory_xact_lock(4242)")
            self._conn.execute(SCHEMA)

    def close(self):
        self._conn.close()
        if self._listener:
            self._listener.close()

    def _all(self, sql, args=()):
        with self._lock:
            return self._conn.execute(sql, args).fetchall()

    def _one(self, sql, args=()):
        rows = self._all(sql, args)
        return rows[0] if rows else None

    def _count(self, sql, args=()):
        with self._lock:
            return self._conn.execute(sql, args).rowcount

    def ping(self):
        return self._one("SELECT 1 AS ok")["ok"] == 1

    # --- memories -------------------------------------------------------------
    def remember(self, text, embedding):
        sql = "INSERT INTO memories (text, embedding) VALUES (%s, %s::vector) RETURNING id"
        return self._one(sql, (text, _vector(embedding)))["id"]

    def memories(self):
        return self._all("SELECT id, text, created FROM memories ORDER BY id")

    def recall(self, embedding, k=5):
        sql = "SELECT id, text, created FROM memories ORDER BY embedding <=> %s::vector LIMIT %s"
        return self._all(sql, (_vector(embedding), k))

    def forget(self, memory_id):
        return self._count("DELETE FROM memories WHERE id = %s", (memory_id,)) > 0

    # --- chat history ---------------------------------------------------------
    def history(self, session):
        row = self._one("SELECT messages FROM history WHERE session = %s", (session,))
        return row["messages"] if row else []

    def save_history(self, session, messages):
        self._count(
            "INSERT INTO history (session, messages) VALUES (%s, %s) "
            "ON CONFLICT (session) DO UPDATE SET messages = excluded.messages",
            (session, json.dumps(messages)),
        )

    # --- job queue ------------------------------------------------------------
    def enqueue(self, kind, input, session=None):
        sql = "INSERT INTO jobs (kind, input, session) VALUES (%s, %s, %s) RETURNING id"
        job_id = self._one(sql, (kind, input, session))["id"]
        self._count(f"NOTIFY {CHANNEL}")
        return job_id

    def claim(self, now=None):
        """Take the oldest queued job; concurrent workers never get the same one."""
        return self._one(
            "UPDATE jobs SET status = 'running', started = %s WHERE id = ("
            "  SELECT id FROM jobs WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1"
            ") RETURNING *",
            (time.time() if now is None else now,),
        )

    def finish(self, job_id, result, ok=True):
        self._count(
            "WITH j AS (UPDATE jobs SET status = %s, result = %s, finished = %s WHERE id = %s RETURNING task_id) "
            "UPDATE tasks SET last_result = %s FROM j WHERE tasks.id = j.task_id",
            ("done" if ok else "failed", result, time.time(), job_id, result),
        )

    def job(self, job_id):
        return self._one("SELECT id, kind, status, result, created, finished FROM jobs WHERE id = %s", (job_id,))

    def requeue_stale(self, older_than):
        """Put back jobs whose worker died mid-run."""
        sql = "UPDATE jobs SET status = 'queued', started = NULL WHERE status = 'running' AND started < %s"
        count = self._count(sql, (older_than,))
        if count:
            self._count(f"NOTIFY {CHANNEL}")
        return count

    def wait_for_jobs(self, timeout):
        """Block until a job is enqueued or `timeout` seconds pass. True if woken."""
        if self._listener is None:
            self._listener = psycopg.connect(self.url, autocommit=True)
            self._listener.execute(f"LISTEN {CHANNEL}")
        return any(True for _ in self._listener.notifies(timeout=timeout, stop_after=1))

    # --- background tasks -----------------------------------------------------
    def add_task(self, prompt, every_minutes, now=None):
        sql = "INSERT INTO tasks (prompt, every_minutes, next_run) VALUES (%s, %s, %s) RETURNING id"
        return self._one(sql, (prompt, every_minutes, time.time() if now is None else now))["id"]

    def tasks(self):
        return self._all("SELECT * FROM tasks ORDER BY id")

    def delete_task(self, task_id):
        return self._count("DELETE FROM tasks WHERE id = %s", (task_id,)) > 0

    def enqueue_due_tasks(self, now):
        """Atomically turn every due task into a job and push its next run forward."""
        count = self._count(
            "WITH due AS (UPDATE tasks SET next_run = %(now)s + every_minutes * 60 "
            "             WHERE next_run <= %(now)s RETURNING id, prompt) "
            "INSERT INTO jobs (kind, input, task_id) SELECT 'task', prompt, id FROM due",
            {"now": now},
        )
        if count:
            self._count(f"NOTIFY {CHANNEL}")
        return count

    # --- domain approvals -----------------------------------------------------
    def is_allowed(self, domain):
        domain = domain.lower()
        approved = {r["domain"] for r in self._all("SELECT domain FROM approvals WHERE status = 'approved'")}
        return any(domain == d or domain.endswith("." + d) for d in self._seeded | approved)

    def request_domain(self, domain):
        domain = domain.lower()
        self._count(
            "INSERT INTO approvals (domain) VALUES (%s) ON CONFLICT (domain) WHERE status = 'pending' DO NOTHING",
            (domain,),
        )
        return self._one("SELECT id FROM approvals WHERE domain = %s AND status = 'pending'", (domain,))["id"]

    def approvals(self):
        return self._all("SELECT * FROM approvals ORDER BY id DESC")

    def decide(self, approval_id, approve):
        sql = "UPDATE approvals SET status = %s WHERE id = %s RETURNING *"
        return self._one(sql, ("approved" if approve else "denied", approval_id))

    # --- audit trail ----------------------------------------------------------
    def audit(self, event, detail):
        self._count("INSERT INTO audit (event, detail) VALUES (%s, %s)", (event, json.dumps(detail)))

    def audit_log(self, limit=100):
        return self._all("SELECT * FROM audit ORDER BY id DESC LIMIT %s", (limit,))
