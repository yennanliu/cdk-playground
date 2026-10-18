"""All of Muse's state in one SQLite file: memories, chat history, tasks, approvals, audit."""

import json
import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY, text TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS history  (session TEXT PRIMARY KEY, messages TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks    (id INTEGER PRIMARY KEY, prompt TEXT NOT NULL, every_minutes INTEGER NOT NULL,
                                     next_run REAL NOT NULL, last_result TEXT);
CREATE TABLE IF NOT EXISTS approvals(id INTEGER PRIMARY KEY, domain TEXT NOT NULL, status TEXT NOT NULL,
                                     created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS audit    (id INTEGER PRIMARY KEY, at REAL NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL);
"""


class Store:
    def __init__(self, path, allowed_domains=()):
        # One connection shared by the API threads and the scheduler, serialized by a lock.
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.executescript(SCHEMA)
        self._seeded = {d.lower() for d in allowed_domains}

    def close(self):
        self._db.close()

    def _query(self, sql, args=()):
        with self._lock:
            return [dict(r) for r in self._db.execute(sql, args).fetchall()]

    def _insert(self, sql, args=()):
        with self._lock, self._db:
            return self._db.execute(sql, args).lastrowid

    def _update(self, sql, args=()):
        with self._lock, self._db:
            return self._db.execute(sql, args).rowcount

    # --- memories -------------------------------------------------------------
    def remember(self, text):
        return self._insert("INSERT INTO memories (text, created) VALUES (?, ?)", (text, time.time()))

    def memories(self):
        return self._query("SELECT id, text, created FROM memories ORDER BY id")

    def recall(self, query):
        words = query.lower().split()
        return [m for m in self.memories() if not words or any(w in m["text"].lower() for w in words)]

    def forget(self, memory_id):
        return self._update("DELETE FROM memories WHERE id = ?", (memory_id,)) > 0

    # --- chat history ---------------------------------------------------------
    def history(self, session):
        rows = self._query("SELECT messages FROM history WHERE session = ?", (session,))
        return json.loads(rows[0]["messages"]) if rows else []

    def save_history(self, session, messages):
        self._insert(
            "INSERT INTO history (session, messages) VALUES (?, ?) "
            "ON CONFLICT(session) DO UPDATE SET messages = excluded.messages",
            (session, json.dumps(messages)),
        )

    # --- background tasks -----------------------------------------------------
    def add_task(self, prompt, every_minutes, now=None):
        return self._insert(
            "INSERT INTO tasks (prompt, every_minutes, next_run) VALUES (?, ?, ?)",
            (prompt, every_minutes, time.time() if now is None else now),
        )

    def tasks(self):
        return self._query("SELECT * FROM tasks ORDER BY id")

    def due_tasks(self, now):
        return self._query("SELECT * FROM tasks WHERE next_run <= ? ORDER BY next_run", (now,))

    def finish_task(self, task_id, result, now):
        self._update(
            "UPDATE tasks SET last_result = ?, next_run = ? + every_minutes * 60 WHERE id = ?",
            (result, now, task_id),
        )

    def delete_task(self, task_id):
        return self._update("DELETE FROM tasks WHERE id = ?", (task_id,)) > 0

    # --- sentinel: domain approvals ------------------------------------------
    def is_allowed(self, domain):
        domain = domain.lower()
        approved = {r["domain"] for r in self._query("SELECT domain FROM approvals WHERE status = 'approved'")}
        return any(domain == d or domain.endswith("." + d) for d in self._seeded | approved)

    def request_domain(self, domain):
        domain = domain.lower()
        pending = self._query("SELECT id FROM approvals WHERE domain = ? AND status = 'pending'", (domain,))
        if pending:
            return pending[0]["id"]
        return self._insert(
            "INSERT INTO approvals (domain, status, created) VALUES (?, 'pending', ?)", (domain, time.time())
        )

    def approvals(self):
        return self._query("SELECT * FROM approvals ORDER BY id DESC")

    def decide(self, approval_id, approve):
        status = "approved" if approve else "denied"
        if not self._update("UPDATE approvals SET status = ? WHERE id = ?", (status, approval_id)):
            return None
        return self._query("SELECT * FROM approvals WHERE id = ?", (approval_id,))[0]

    # --- audit trail ----------------------------------------------------------
    def audit(self, event, detail):
        self._insert("INSERT INTO audit (at, event, detail) VALUES (?, ?, ?)", (time.time(), event, json.dumps(detail)))

    def audit_log(self, limit=100):
        rows = self._query("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,))
        return [{**r, "detail": json.loads(r["detail"])} for r in rows]
