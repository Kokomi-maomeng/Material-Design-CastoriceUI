from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


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

    def add_audit(self, action: str, category: str, detail: str, source_ip: str = "127.0.0.1", result: str = "成功") -> None:
        with self.lock, self.connect() as connection:
            connection.execute(
                "INSERT INTO audits(action,category,actor,source_ip,result,detail,created_at) VALUES(?,?,?,?,?,?,?)",
                (action, category, "admin", source_ip, result, detail[:500], utc_now()),
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
