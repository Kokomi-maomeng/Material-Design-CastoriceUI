from __future__ import annotations

import json
import ipaddress
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .security import normalize_https_base_url, normalize_loopback_endpoint, validate_interface_name


DEFAULT_INTEGRATIONS = {
    "system": {"enabled": True, "configured": True},
    "hysteria2": {"enabled": False, "configured": False},
    "anytls": {"enabled": False, "configured": False},
    "vless": {"enabled": False, "configured": False},
    "socks5": {"enabled": False, "configured": False},
    "shadowsocks": {"enabled": False, "configured": False},
    "vmess": {"enabled": False, "configured": False},
    "trojan": {"enabled": False, "configured": False},
    "tuic": {"enabled": False, "configured": False},
    "connections": {"enabled": True, "configured": True},
    "traffic": {"enabled": True, "configured": True},
    "subscriptions": {"enabled": False, "configured": False},
    "network": {"enabled": True, "configured": True},
    "alerts": {"enabled": True, "configured": True},
    "audit": {"enabled": True, "configured": True},
}

PUBLIC_INTEGRATION_VALUES = {
    "system": {"nodeName"},
    "hysteria2": {"endpoint", "identityMappings"},
    "anytls": {"endpoint", "inboundTags"},
    "vless": {"endpoint", "inboundTags", "securityProfile"},
    "socks5": {"endpoint", "inboundTags"},
    "shadowsocks": {"endpoint", "inboundTags"},
    "vmess": {"endpoint", "inboundTags"},
    "trojan": {"endpoint", "inboundTags"},
    "tuic": {"endpoint", "inboundTags"},
    "traffic": {"interface", "quotaGb", "billingDay", "billingTimezone", "initialUsedGb", "countMode"},
    "network": {"targets"},
    "alerts": {"trafficPercent", "latencyMs", "lossPercent"},
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
    redact_live_data: bool = True
    alert_thresholds: dict[str, float] = field(default_factory=lambda: {"trafficPercent": 80.0, "latencyMs": 150.0, "lossPercent": 5.0})
    protocol_adapters: dict[str, dict[str, Any]] = field(default_factory=dict)
    bootstrap_token_path: str = "/var/lib/castoriceui/bootstrap-token"
    login_background_directory: str = "/var/lib/castoriceui/login-backgrounds"
    secure_cookies: bool = True
    session_lifetime_seconds: int = 43_200
    traffic_billing_day: int = 1
    traffic_billing_timezone: str = "UTC"
    traffic_initial_used_bytes: int = 0
    traffic_initial_used_cycle: str = ""
    traffic_count_mode: str = "sum"
    audit_retention_days: int = 180
    external_background_hosts: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, path: str | Path) -> "AppConfig":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("Configuration root must be an object")
        allowed = set(cls.__dataclass_fields__)
        unknown = sorted(set(raw) - allowed)
        if unknown:
            raise ValueError(f"Unknown configuration field(s): {', '.join(unknown)}")
        config = cls(**raw)
        config._validate()
        merged = {key: dict(value) for key, value in DEFAULT_INTEGRATIONS.items()}
        for key, value in config.integrations.items():
            if key in merged and isinstance(value, dict):
                merged[key].update(value)
        config.integrations = merged
        return config

    def _validate(self) -> None:
        try:
            listen_address = ipaddress.ip_address(self.listen_host)
        except ValueError as error:
            raise ValueError("listen_host must be a loopback IP address") from error
        if not listen_address.is_loopback:
            raise ValueError("listen_host must be a loopback IP address")
        if not isinstance(self.listen_port, int) or not 1 <= self.listen_port <= 65535:
            raise ValueError("listen_port must be between 1 and 65535")
        if not self.secure_cookies:
            raise ValueError("secure_cookies must remain enabled in a loaded production configuration")
        if not isinstance(self.session_lifetime_seconds, int) or not 900 <= self.session_lifetime_seconds <= 30 * 86400:
            raise ValueError("session_lifetime_seconds must be between 900 and 2592000")
        if not isinstance(self.redact_live_data, bool):
            raise ValueError("redact_live_data must be a boolean")
        if not 1_000_000_000 <= int(self.traffic_limit_bytes) <= 1_000_000_000_000_000:
            raise ValueError("traffic_limit_bytes must be between 1 GB and 1 PB")
        if not isinstance(self.traffic_billing_day, int) or not 1 <= self.traffic_billing_day <= 28:
            raise ValueError("traffic_billing_day must be between 1 and 28")
        if self.traffic_billing_timezone != "UTC":
            try:
                ZoneInfo(self.traffic_billing_timezone)
            except (ZoneInfoNotFoundError, TypeError) as error:
                raise ValueError("traffic_billing_timezone must be UTC or an installed IANA timezone") from error
        if not isinstance(self.traffic_initial_used_bytes, int) or self.traffic_initial_used_bytes < 0:
            raise ValueError("traffic_initial_used_bytes must be a non-negative integer")
        if self.traffic_initial_used_cycle:
            try:
                datetime.strptime(self.traffic_initial_used_cycle, "%Y-%m-%d")
            except ValueError as error:
                raise ValueError("traffic_initial_used_cycle must use YYYY-MM-DD") from error
        if self.traffic_count_mode not in {"sum", "max"}:
            raise ValueError("traffic_count_mode must be sum or max")
        if not isinstance(self.audit_retention_days, int) or not 7 <= self.audit_retention_days <= 3650:
            raise ValueError("audit_retention_days must be between 7 and 3650")
        for field_name in ("database_path", "bootstrap_token_path", "login_background_directory"):
            value = str(getattr(self, field_name))
            if not (PurePosixPath(value).is_absolute() or PureWindowsPath(value).is_absolute()):
                raise ValueError(f"{field_name} must be an absolute path")
        if self.certificate_path and not (PurePosixPath(self.certificate_path).is_absolute() or PureWindowsPath(self.certificate_path).is_absolute()):
            raise ValueError("certificate_path must be an absolute path")
        if self.interface:
            self.interface = validate_interface_name(self.interface)
        for field_name in ("hysteria_api", "singbox_api"):
            endpoint = getattr(self, field_name)
            if not isinstance(endpoint, dict):
                raise ValueError(f"{field_name} must be an object")
            unknown_endpoint = sorted(set(endpoint) - {"url", "secret"})
            if unknown_endpoint:
                raise ValueError(f"{field_name} contains unknown field(s): {', '.join(unknown_endpoint)}")
            if endpoint.get("url"):
                endpoint["url"] = normalize_loopback_endpoint(str(endpoint["url"]))
        if self.subscription_base_url:
            self.subscription_base_url = normalize_https_base_url(self.subscription_base_url)
        for field_name in ("integrations", "protocol_adapters", "alert_thresholds"):
            if not isinstance(getattr(self, field_name), dict):
                raise ValueError(f"{field_name} must be an object")
        unknown_integrations = sorted(set(self.integrations) - set(DEFAULT_INTEGRATIONS))
        if unknown_integrations:
            raise ValueError(f"integrations contains unknown id(s): {', '.join(unknown_integrations)}")
        adapter_ids = {"anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"}
        unknown_adapters = sorted(set(self.protocol_adapters) - adapter_ids)
        if unknown_adapters:
            raise ValueError(f"protocol_adapters contains unknown id(s): {', '.join(unknown_adapters)}")
        for adapter_id, adapter in self.protocol_adapters.items():
            if not isinstance(adapter, dict) or set(adapter) - {"inboundTags", "securityProfile"}:
                raise ValueError(f"protocol_adapters.{adapter_id} contains an unknown field")
            tags = adapter.get("inboundTags", [])
            if (
                not isinstance(tags, list)
                or len(tags) > 20
                or any(not isinstance(tag, str) or not tag.strip() or len(tag.strip()) > 80 for tag in tags)
            ):
                raise ValueError(f"protocol_adapters.{adapter_id}.inboundTags must contain at most 20 non-empty strings of at most 80 characters")
            normalized_tags = [tag.strip() for tag in tags]
            if len({tag.casefold() for tag in normalized_tags}) != len(normalized_tags):
                raise ValueError(f"protocol_adapters.{adapter_id}.inboundTags contains duplicate tags")
            adapter["inboundTags"] = normalized_tags
            if adapter_id == "vless":
                profile = adapter.get("securityProfile", "standard")
                if profile not in {"standard", "xtls-vision", "reality", "xtls-vision-reality"}:
                    raise ValueError("protocol_adapters.vless.securityProfile is invalid")
                adapter["securityProfile"] = profile
            elif "securityProfile" in adapter:
                raise ValueError(f"protocol_adapters.{adapter_id}.securityProfile is not supported")
        owners: dict[str, str] = {}
        for adapter_id, adapter in self.protocol_adapters.items():
            for tag in adapter["inboundTags"]:
                key = tag.casefold()
                if key in owners:
                    raise ValueError(f"Inbound tag {tag!r} is assigned to both {owners[key]} and {adapter_id}")
                owners[key] = adapter_id
        for field_name in ("network_targets", "managed_accounts", "subscriptions"):
            value = getattr(self, field_name)
            if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
                raise ValueError(f"{field_name} must be a list of objects")
        schemas = {
            "network_targets": {"id", "name", "provider", "address", "ipVersion", "order"},
            "managed_accounts": {"id", "name", "email", "status", "protocols", "expiresAt", "note", "trafficIdentities"},
            "subscriptions": {"id", "account", "tokenHint", "protocols", "updatedAt", "lastFetchedAt", "enabled", "url"},
        }
        for field_name, schema in schemas.items():
            for index, item in enumerate(getattr(self, field_name)):
                unknown_nested = sorted(set(item) - schema)
                if unknown_nested:
                    raise ValueError(f"{field_name}[{index}] contains unknown field(s): {', '.join(unknown_nested)}")
        for index, account in enumerate(self.managed_accounts):
            identities = account.get("trafficIdentities", {})
            if identities in (None, []):
                continue
            if isinstance(identities, list):
                identities = {"hysteria2": identities}
                account["trafficIdentities"] = identities
            if not isinstance(identities, dict) or set(identities) - {"hysteria2"}:
                raise ValueError(f"managed_accounts[{index}].trafficIdentities must contain only hysteria2")
            values = identities.get("hysteria2", [])
            if not isinstance(values, list) or len(values) > 20 or any(not str(value).strip() or len(str(value)) > 160 for value in values):
                raise ValueError(f"managed_accounts[{index}].trafficIdentities.hysteria2 is invalid")
        if not isinstance(self.external_background_hosts, list):
            raise ValueError("external_background_hosts must be a list")
        normalized_hosts: list[str] = []
        for value in self.external_background_hosts:
            host = str(value).strip().rstrip(".").lower()
            if not host or "/" in host or ":" in host or "@" in host:
                raise ValueError("external_background_hosts contains an invalid host")
            normalized_hosts.append(host)
        self.external_background_hosts = list(dict.fromkeys(normalized_hosts))

    def public_integrations(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for key, value in self.integrations.items():
            public = {
                "id": key,
                "enabled": bool(value.get("enabled")),
                "configured": bool(value.get("configured")),
                "status": value.get("status", "ready" if value.get("configured") else "pending"),
                "summary": value.get("summary", ""),
                "summaryZh": value.get("summaryZh", ""),
                "summaryEn": value.get("summaryEn", value.get("summary", "")),
            }
            stored_values = value.get("values", {})
            if isinstance(stored_values, dict) and key in PUBLIC_INTEGRATION_VALUES:
                public["values"] = {
                    field: str(stored_values[field])
                    for field in PUBLIC_INTEGRATION_VALUES[key]
                    if field in stored_values
                }
            result.append(public)
        return result
