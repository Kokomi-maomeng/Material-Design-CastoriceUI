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
    def __init__(self, path: str, audit_retention_days: int = 180) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.audit_retention_days = max(7, min(int(audit_retention_days), 3650))
        self.lock = threading.RLock()
        self._initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
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
                    memory REAL NOT NULL,
                    interface TEXT NOT NULL DEFAULT '',
                    boot_id TEXT NOT NULL DEFAULT ''
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
                CREATE TABLE IF NOT EXISTS alert_state (
                    alert_id TEXT PRIMARY KEY,
                    episode_id TEXT NOT NULL,
                    active INTEGER NOT NULL,
                    started_at TEXT NOT NULL,
                    acknowledged_at TEXT
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
                CREATE TABLE IF NOT EXISTS login_failures (
                    source_ip TEXT NOT NULL,
                    failed_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
                CREATE INDEX IF NOT EXISTS audits_category_id ON audits(category, id DESC);
                CREATE INDEX IF NOT EXISTS login_failures_source_time ON login_failures(source_ip, failed_at);
                """
            )
            sample_columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(samples)")}
            if "interface" not in sample_columns:
                connection.execute("ALTER TABLE samples ADD COLUMN interface TEXT NOT NULL DEFAULT ''")
            if "boot_id" not in sample_columns:
                connection.execute("ALTER TABLE samples ADD COLUMN boot_id TEXT NOT NULL DEFAULT ''")

    def record_sample(self, captured_at: int, rx: int, tx: int, cpu: float, memory: float, interface: str = "", boot_id: str = "") -> None:
        with self.lock, self.connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO samples(captured_at,rx_bytes,tx_bytes,cpu,memory,interface,boot_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (captured_at, rx, tx, cpu, memory, interface[:32], boot_id[:64]),
            )

    def samples_since(self, timestamp: int) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM samples WHERE captured_at >= ? ORDER BY captured_at", (timestamp,)
            ).fetchall()
        return [dict(row) for row in rows]

    def traffic_usage_since(self, timestamp: int, count_mode: str = "sum", initial_used_bytes: int = 0) -> dict[str, Any]:
        samples = self.samples_since(timestamp)
        last_by_source: dict[tuple[str, str], tuple[int, int]] = {}
        received = transmitted = 0
        for sample in samples:
            source = (str(sample.get("interface") or "legacy"), str(sample.get("boot_id") or "legacy"))
            previous = last_by_source.get(source)
            current = (int(sample["rx_bytes"]), int(sample["tx_bytes"]))
            if previous is not None:
                received += max(0, current[0] - previous[0])
                transmitted += max(0, current[1] - previous[1])
            last_by_source[source] = current
        measured = max(received, transmitted) if count_mode == "max" else received + transmitted
        baseline = max(0, int(initial_used_bytes))
        return {
            "usedBytes": baseline + measured,
            "receivedBytes": received,
            "transmittedBytes": transmitted,
            "baselineBytes": baseline,
            "countMode": count_mode,
        }

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
            cutoff = datetime.fromtimestamp(time.time() - self.audit_retention_days * 86400, timezone.utc).isoformat(timespec="seconds")
            connection.execute("DELETE FROM audits WHERE created_at < ?", (cutoff,))

    def audit_page(self, page: int = 1, page_size: int = 30, search: str = "", category: str = "") -> dict[str, Any]:
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 100))
        search = search.strip()[:200]
        category = category.strip()[:32]
        clauses: list[str] = []
        parameters: list[Any] = []
        if category:
            clauses.append("category = ?")
            parameters.append(category)
        if search:
            clauses.append("(action LIKE ? OR actor LIKE ? OR source_ip LIKE ? OR detail LIKE ?)")
            pattern = f"%{search}%"
            parameters.extend([pattern, pattern, pattern, pattern])
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as connection:
            total = int(connection.execute(f"SELECT COUNT(*) FROM audits{where}", parameters).fetchone()[0])
            total_pages = max(1, (total + page_size - 1) // page_size)
            page = min(page, total_pages)
            rows = connection.execute(
                f"SELECT * FROM audits{where} ORDER BY id DESC LIMIT ? OFFSET ?",
                [*parameters, page_size, (page - 1) * page_size],
            ).fetchall()
        return {
            "items": [dict(row) for row in rows],
            "total": total,
            "page": page,
            "pageSize": page_size,
            "totalPages": total_pages,
        }

    def reconcile_alerts(self, alert_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Track alert episodes so a recovered condition can notify again later."""
        current_ids = list(dict.fromkeys(str(value)[:160] for value in alert_ids if value))
        now = utc_now()
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if current_ids:
                placeholders = ",".join("?" for _ in current_ids)
                connection.execute(
                    f"UPDATE alert_state SET active=0 WHERE active=1 AND alert_id NOT IN ({placeholders})",
                    current_ids,
                )
            else:
                connection.execute("UPDATE alert_state SET active=0 WHERE active=1")
            for alert_id in current_ids:
                row = connection.execute(
                    "SELECT active FROM alert_state WHERE alert_id=?", (alert_id,)
                ).fetchone()
                if row is None:
                    connection.execute(
                        "INSERT INTO alert_state(alert_id,episode_id,active,started_at,acknowledged_at) VALUES(?,?,?,?,NULL)",
                        (alert_id, secrets.token_urlsafe(18), 1, now),
                    )
                elif not bool(row["active"]):
                    connection.execute(
                        "UPDATE alert_state SET episode_id=?,active=1,started_at=?,acknowledged_at=NULL WHERE alert_id=?",
                        (secrets.token_urlsafe(18), now, alert_id),
                    )
            rows = connection.execute(
                "SELECT alert_id,episode_id,started_at,acknowledged_at FROM alert_state WHERE active=1"
            ).fetchall()
        return {
            str(row["alert_id"]): {
                "episodeId": str(row["episode_id"]),
                "startedAt": str(row["started_at"]),
                "acknowledged": row["acknowledged_at"] is not None,
            }
            for row in rows
        }

    def acknowledge(self, alert_id: str) -> bool:
        with self.lock, self.connect() as connection:
            cursor = connection.execute(
                "UPDATE alert_state SET acknowledged_at=? WHERE alert_id=? AND active=1",
                (utc_now(), alert_id),
            )
        return cursor.rowcount == 1

    def acknowledged(self) -> set[str]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT alert_id FROM alert_state WHERE active=1 AND acknowledged_at IS NOT NULL"
            ).fetchall()
        return {str(row["alert_id"]) for row in rows}

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

    def session(self, token: str, idle_timeout_seconds: int = 0) -> dict[str, Any] | None:
        if not token:
            return None
        now = int(time.time())
        cutoff = datetime.fromtimestamp(now - max(0, int(idle_timeout_seconds)), timezone.utc).isoformat(timespec="seconds")
        with self.lock, self.connect() as connection:
            if idle_timeout_seconds > 0:
                connection.execute("DELETE FROM sessions WHERE expires_at<=? OR last_seen_at<?", (now, cutoff))
            else:
                connection.execute("DELETE FROM sessions WHERE expires_at<=?", (now,))
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

    def login_allowed(self, source_ip: str, limit: int = 5, window_seconds: int = 600) -> bool:
        cutoff = int(time.time()) - window_seconds
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM login_failures WHERE failed_at<?", (cutoff,))
            count = int(connection.execute(
                "SELECT COUNT(*) FROM login_failures WHERE source_ip=? AND failed_at>=?",
                (source_ip, cutoff),
            ).fetchone()[0])
        return count < limit

    def record_login_failure(self, source_ip: str) -> None:
        with self.lock, self.connect() as connection:
            connection.execute("INSERT INTO login_failures(source_ip,failed_at) VALUES(?,?)", (source_ip, int(time.time())))

    def clear_login_failures(self, source_ip: str) -> None:
        with self.lock, self.connect() as connection:
            connection.execute("DELETE FROM login_failures WHERE source_ip=?", (source_ip,))

    def database_size(self) -> int:
        return sum(
            candidate.stat().st_size
            for candidate in (Path(self.path), Path(self.path + "-wal"), Path(self.path + "-shm"))
            if candidate.is_file()
        )
