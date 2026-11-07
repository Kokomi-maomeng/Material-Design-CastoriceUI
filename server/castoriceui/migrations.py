"""Narrow, idempotent upgrade cleanup for retired features."""
from __future__ import annotations

import sqlite3
import json
from typing import Any

RETIRED_CONFIG_KEYS = frozenset({"external_probe_secret", "external_probe_agents", "external_probe_protocols"})


def retire_navigation_panels(connection: sqlite3.Connection) -> None:
    """Remove retired navigation entries while preserving other preferences."""
    row = connection.execute("SELECT value FROM settings WHERE key='ui_settings'").fetchone()
    settings = json.loads(row[0]) if row else {}
    panels = settings.get("visiblePanels") if isinstance(settings, dict) else None
    if isinstance(panels, list) and any(panel in ("subscriptions", "connections") for panel in panels):
        settings["visiblePanels"] = [panel for panel in panels if panel not in ("subscriptions", "connections")]
        connection.execute("UPDATE settings SET value=? WHERE key='ui_settings'", (json.dumps(settings, ensure_ascii=False),))


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
