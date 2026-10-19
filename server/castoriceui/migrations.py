"""Narrow, idempotent upgrade cleanup for retired features."""
from __future__ import annotations

import sqlite3
from typing import Any

RETIRED_CONFIG_KEYS = frozenset({"external_probe_secret", "external_probe_agents", "external_probe_protocols"})


def retired_config(raw: dict[str, Any]) -> dict[str, Any]:
    """Accept old files during an upgrade without enabling the retired feature."""
    return {key: value for key, value in raw.items() if key not in RETIRED_CONFIG_KEYS}


def retired_alert_id(value: str) -> bool:
    return str(value).startswith(("monitor-external-", "observer-"))


def retire_external_monitoring(connection: sqlite3.Connection) -> None:
    """Delete only external-observer records; unrelated episodes stay byte exact."""
    retired = "alert_id GLOB 'monitor-external-*' OR alert_id GLOB 'observer-*'"
    connection.execute(f"DELETE FROM alert_evidence WHERE episode_id IN (SELECT episode_id FROM alert_history WHERE {retired} UNION SELECT episode_id FROM alert_state WHERE {retired})")
    connection.execute(f"DELETE FROM alert_history WHERE {retired}")
    connection.execute(f"DELETE FROM alert_state WHERE {retired}")
    connection.execute("DELETE FROM monitoring_samples WHERE domain='external' OR (domain='alert' AND (target GLOB 'monitor-external-*' OR target GLOB 'observer-*'))")
    connection.execute("DELETE FROM settings WHERE key='external_business_incidents'")
    connection.execute("DROP TABLE IF EXISTS probe_nonces")
