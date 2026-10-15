"""Verified archives of recovered, acknowledged episodes; private local data."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import secrets
from datetime import datetime, timedelta, timezone


def capacity(storage, limit: int = 10000) -> dict:
    with storage.connect() as connection:
        row = connection.execute("SELECT COUNT(*) AS total, COALESCE(SUM(resolved_at IS NULL OR acknowledged_at IS NULL),0) AS protected FROM alert_history").fetchone()
    return {"episodes": row["total"], "protectedEpisodes": row["protected"], "onlineLimit": limit,
            "requiresAttention": row["total"] > limit, "policy": "archive-recovered-and-acknowledged-only"}


def archive(storage, directory: Path, *, days: int = 180, limit: int = 10000) -> dict:
    if not 7 <= days <= 3650 or not 100 <= limit <= 100000:
        raise ValueError("Invalid alert retention policy")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
    with storage.lock, storage.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        count = connection.execute("SELECT COUNT(*) FROM alert_history").fetchone()[0]
        overflow = max(0, count - limit)
        rows = connection.execute("SELECT * FROM alert_history WHERE resolved_at IS NOT NULL AND acknowledged_at IS NOT NULL ORDER BY resolved_at,episode_id LIMIT 500").fetchall()
        selected = [row for index, row in enumerate(rows) if row["resolved_at"] < cutoff or index < overflow]
        if not selected:
            return {"archived": 0, "remaining": count}
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory.is_symlink():
            raise ValueError("Archive directory must not be a symlink")
        os.chmod(directory, 0o700)
        records = []
        for row in selected:
            evidence = connection.execute("SELECT * FROM alert_evidence WHERE episode_id=?", (row["episode_id"],)).fetchone()
            records.append({"history": dict(row), "evidence": dict(evidence) if evidence else None})
        payload = {"schema": 1, "records": records}
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()
        if len(serialized) > 64 * 1024 * 1024:
            raise ValueError("Alert archive exceeds size limit; database retained")
        encoded = gzip.compress(serialized, mtime=0)
        digest = hashlib.sha256(encoded).hexdigest()
        destination = directory / ("alerts-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(6) + ".json.gz")
        with destination.open("xb") as handle:
            os.chmod(destination, 0o600)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        with destination.with_suffix(destination.suffix + ".sha256").open("x", encoding="ascii") as handle:
            os.chmod(handle.name, 0o600)
            handle.write(digest + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        actual = destination.read_bytes()
        if hashlib.sha256(actual).hexdigest() != digest or json.loads(gzip.decompress(actual)) != payload:
            raise ValueError("Alert archive verification failed; database retained")
        if hasattr(os, "O_DIRECTORY"):
            descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        for row in selected:
            episode = row["episode_id"]
            connection.execute("DELETE FROM alert_evidence WHERE episode_id=?", (episode,))
            connection.execute("DELETE FROM alert_history WHERE episode_id=? AND resolved_at IS NOT NULL AND acknowledged_at IS NOT NULL", (episode,))
            connection.execute("DELETE FROM alert_state WHERE episode_id=? AND active=0", (episode,))
        return {"archived": len(selected), "remaining": count - len(selected), "sha256": digest, "archive": destination.name}


def restore(storage, path: Path) -> int:
    if path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("Alert archive exceeds size limit")
    encoded = path.read_bytes()
    expected = path.with_suffix(path.suffix + ".sha256").read_text(encoding="ascii").strip()
    if hashlib.sha256(encoded).hexdigest() != expected:
        raise ValueError("Alert archive checksum mismatch")
    with gzip.open(path, "rb") as handle:
        decoded = handle.read(64 * 1024 * 1024 + 1)
    if len(decoded) > 64 * 1024 * 1024:
        raise ValueError("Expanded alert archive exceeds size limit")
    payload = json.loads(decoded)
    if payload.get("schema") != 1 or not isinstance(payload.get("records"), list) or len(payload["records"]) > 500:
        raise ValueError("Invalid alert archive schema")
    restored = 0
    with storage.lock, storage.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        for record in payload["records"]:
            row = record["history"]
            if not row.get("resolved_at") or not row.get("acknowledged_at"):
                raise ValueError("Archive contains a protected episode")
            existing = connection.execute("SELECT * FROM alert_history WHERE episode_id=?", (row["episode_id"],)).fetchone()
            if existing:
                if dict(existing) != row:
                    raise ValueError("Archive conflicts with an existing episode")
                continue
            connection.execute("INSERT INTO alert_history VALUES(?,?,?,?,?,?)", tuple(row[key] for key in ("episode_id", "alert_id", "payload_json", "started_at", "resolved_at", "acknowledged_at")))
            evidence = record.get("evidence")
            if evidence:
                connection.execute("INSERT INTO alert_evidence VALUES(?,?,?,?,?)", tuple(evidence[key] for key in ("episode_id", "first_json", "last_json", "worst_json", "updated_at")))
            restored += 1
    return restored
