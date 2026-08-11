from __future__ import annotations

import json
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .auth import dummy_password_check, hash_password, token_hash, validate_password, validate_username, verify_password


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Storage:
    def __init__(self, path: str) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.RLock()
        self._initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS samples (
                    captured_at INTEGER PRIMARY KEY,
                    rx_bytes INTEGER NOT NULL,
                    tx_bytes INTEGER NOT NULL,
                    cpu REAL NOT NULL,
                    memory REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    category TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    source_ip TEXT NOT NULL,
                    result TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS acknowledgements (
                    alert_id TEXT PRIMARY KEY,
                    acknowledged_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_login_at TEXT
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    csrf_token TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
                """
            )

    def record_sample(self, captured_at: int, rx: int, tx: int, cpu: float, memory: float) -> None:
        with self.lock, self.connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO samples VALUES (?, ?, ?, ?, ?)",
                (captured_at, rx, tx, cpu, memory),
            )
            connection.execute("DELETE FROM samples WHERE captured_at < ?", (captured_at - 90 * 86400,))

    def samples_since(self, timestamp: int) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM samples WHERE captured_at >= ? ORDER BY captured_at", (timestamp,)
            ).fetchall()
        return [dict(row) for row in rows]

    def get_setting(self, key: str, default: Any) -> Any:
        with self.connect() as connection:
            row = connection.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return default if row is None else json.loads(row["value"])

    def set_setting(self, key: str, value: Any) -> None:
        with self.lock, self.connect() as connection:
            connection.execute(
                "INSERT INTO settings VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (key, json.dumps(value, ensure_ascii=False), utc_now()),
            )

    def add_audit(self, action: str, category: str, detail: str, source_ip: str = "127.0.0.1", result: str = "成功", actor: str = "system") -> None:
        with self.lock, self.connect() as connection:
            connection.execute(
                "INSERT INTO audits(action,category,actor,source_ip,result,detail,created_at) VALUES(?,?,?,?,?,?,?)",
                (action, category, actor[:64], source_ip, result, detail[:500], utc_now()),
            )

    def audits(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM audits ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(row) for row in rows]

    def acknowledge(self, alert_id: str) -> None:
        with self.lock, self.connect() as connection:
            connection.execute("INSERT OR REPLACE INTO acknowledgements VALUES (?, ?)", (alert_id, utc_now()))

    def acknowledged(self) -> set[str]:
        with self.connect() as connection:
            rows = connection.execute("SELECT alert_id FROM acknowledgements").fetchall()
        return {row["alert_id"] for row in rows}

    def has_users(self) -> bool:
        with self.connect() as connection:
            return connection.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None

    def create_initial_user(self, username: str, password: str) -> int:
        username = validate_username(username)
        password = validate_password(password)
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None:
                raise ValueError("Initial administrator already exists")
            cursor = connection.execute(
                "INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)",
                (username, hash_password(password), utc_now()),
            )
        return int(cursor.lastrowid)

    def authenticate(self, username: str, password: str) -> tuple[int, str] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id,username,password_hash FROM users WHERE username=? COLLATE NOCASE",
                (username.strip(),),
            ).fetchone()
        if row is None:
            dummy_password_check(password)
            return None
        if not verify_password(password, str(row["password_hash"])):
            return None
        with self.lock, self.connect() as connection:
            connection.execute("UPDATE users SET last_login_at=? WHERE id=?", (utc_now(), int(row["id"])))
        return int(row["id"]), str(row["username"])

    def create_session(self, user_id: int, lifetime_seconds: int) -> tuple[str, str, int]:
        token = secrets.token_urlsafe(48)
        csrf_token = secrets.token_urlsafe(32)
        expires_at = int(time.time()) + max(900, min(int(lifetime_seconds), 30 * 86400))
        now = utc_now()
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at<=?", (int(time.time()),))
            connection.execute(
                "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)",
                (token_hash(token), user_id, csrf_token, expires_at, now, now),
            )
        return token, csrf_token, expires_at

    def session(self, token: str) -> dict[str, Any] | None:
        if not token:
            return None
        now = int(time.time())
        with self.lock, self.connect() as connection:
            row = connection.execute(
                """
                SELECT sessions.user_id,users.username,sessions.csrf_token,sessions.expires_at
                FROM sessions JOIN users ON users.id=sessions.user_id
                WHERE sessions.token_hash=? AND sessions.expires_at>?
                """,
                (token_hash(token), now),
            ).fetchone()
            if row is not None:
                connection.execute("UPDATE sessions SET last_seen_at=? WHERE token_hash=?", (utc_now(), token_hash(token)))
        return dict(row) if row is not None else None

    def delete_session(self, token: str) -> None:
        if not token:
            return
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(token),))
