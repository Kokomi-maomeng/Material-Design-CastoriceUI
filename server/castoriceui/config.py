from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


DEFAULT_INTEGRATIONS = {
    "system": {"enabled": True, "configured": True},
    "hysteria2": {"enabled": False, "configured": False},
    "anytls": {"enabled": False, "configured": False},
    "vless": {"enabled": False, "configured": False},
    "socks5": {"enabled": False, "configured": False},
    "shadowsocks": {"enabled": False, "configured": False},
    "connections": {"enabled": True, "configured": True},
    "traffic": {"enabled": True, "configured": True},
    "subscriptions": {"enabled": False, "configured": False},
    "network": {"enabled": True, "configured": True},
    "alerts": {"enabled": True, "configured": True},
    "audit": {"enabled": True, "configured": True},
}


@dataclass(slots=True)
class AppConfig:
    listen_host: str = "127.0.0.1"
    listen_port: int = 18080
    database_path: str = "/var/lib/castoriceui/state.db"
    node_name: str = "VPS node"
    interface: str = ""
    traffic_limit_bytes: int = 1_000_000_000_000
    certificate_path: str = ""
    subscription_base_url: str = ""
    hysteria_api: dict[str, Any] = field(default_factory=dict)
    singbox_api: dict[str, Any] = field(default_factory=dict)
    integrations: dict[str, dict[str, Any]] = field(default_factory=dict)
    network_targets: list[dict[str, Any]] = field(default_factory=list)
    managed_accounts: list[dict[str, Any]] = field(default_factory=list)
    subscriptions: list[dict[str, Any]] = field(default_factory=list)
    redact_live_data: bool = False
    alert_thresholds: dict[str, float] = field(default_factory=lambda: {"trafficPercent": 80.0, "latencyMs": 150.0, "lossPercent": 5.0})
    protocol_adapters: dict[str, dict[str, Any]] = field(default_factory=dict)
    bootstrap_token_path: str = "/var/lib/castoriceui/bootstrap-token"
    login_background_directory: str = "/var/lib/castoriceui/login-backgrounds"
    secure_cookies: bool = True
    session_lifetime_seconds: int = 43_200

    @classmethod
    def load(cls, path: str | Path) -> "AppConfig":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        allowed = set(cls.__dataclass_fields__)
        config = cls(**{key: value for key, value in raw.items() if key in allowed})
        merged = {key: dict(value) for key, value in DEFAULT_INTEGRATIONS.items()}
        for key, value in config.integrations.items():
            if key in merged and isinstance(value, dict):
                merged[key].update(value)
        config.integrations = merged
        return config

    def public_integrations(self) -> list[dict[str, Any]]:
        return [
            {
                "id": key,
                "enabled": bool(value.get("enabled")),
                "configured": bool(value.get("configured")),
                "status": value.get("status", "ready" if value.get("configured") else "pending"),
                "summary": value.get("summary", ""),
                "summaryZh": value.get("summaryZh", ""),
                "summaryEn": value.get("summaryEn", value.get("summary", "")),
            }
            for key, value in self.integrations.items()
        ]
