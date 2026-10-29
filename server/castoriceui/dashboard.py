from __future__ import annotations

import threading
import time
import copy
import hashlib
import ipaddress
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from .monitoring import NetworkPolicy, ResourcePressure, event, timestamp, maintenance_info
from .alert_policy import AlertPolicy
from .network_sampling import NetworkSeries
from .alert_dto import with_alert_time
from .collectors import layered_probe
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .collectors import (
    SystemCollector,
    connection_snapshots,
    http_json,
    hysteria_snapshot,
    network_snapshots,
    PROTOCOLS,
    protocol_requested,
    protocol_readiness,
    read_protocol_inventory,
    valid_singbox_payload,
    service_snapshots,
    singbox_snapshot,
)
from .config import AppConfig, DEFAULT_INTEGRATIONS, normalize_alert_thresholds
from .validation import integer, number, boolean
from .security import normalize_loopback_endpoint, normalize_subscription_url, probe_subscription_url, validate_interface_name, validate_probe_target
from .storage import Storage
from .traffic_quota import baseline_for_cycle, normalize_quota_state, traffic_quota_period, utc_cycle_id, validate_timezone


VISIBLE_PANEL_ORDER = ("alerts", "accounts", "subscriptions", "services", "network", "connections", "traffic", "audit")
INTEGRATION_FIELD_LIMITS = {
    "endpoint": 2048,
    "identityMappings": 8192,
    "inboundTags": 2048,
    "securityProfile": 64,
    "interface": 128,
    "quotaGb": 64,
    "billingDay": 16,
    "billingTimezone": 128,
    "initialUsedGb": 64,
    "countMode": 16,
    "baseUrl": 4096,
    "targets": 8192,
    "trafficPercent": 64,
    "latencyMs": 64,
    "lossPercent": 64,
    "nodeName": 80,
}


def ordered_visible_panels(value: Any) -> list[str]:
    if not isinstance(value, list):
        return list(VISIBLE_PANEL_ORDER)
    visible = {str(item) for item in value}
    return [panel for panel in VISIBLE_PANEL_ORDER if panel in visible]


class DashboardService:
    def __init__(self, config: AppConfig, storage: Storage) -> None:
        self.config = config
        merged_integrations = {key: dict(value) for key, value in DEFAULT_INTEGRATIONS.items()}
        for key, value in config.integrations.items():
            if key in merged_integrations and isinstance(value, dict):
                merged_integrations[key].update(value)
        config.integrations = merged_integrations
        self.storage = storage
        self.system_collector = SystemCollector(config, storage)
        self.lock = threading.RLock()
        self.snapshot_lock = threading.Lock()
        self.network_generation = 0
        self.collection_state: dict[str, dict[str, Any]] = {}
        self.started_monotonic = time.monotonic()
        self.network_policy = NetworkPolicy()
        self.network_series = NetworkSeries()
        self.network_recorded_at = 0.0
        self.network_recorded_monotonic = 0.0
        self.network_time_cache: dict[tuple[str, int], list[dict[str, Any]]] = {}
        self.alert_policy = AlertPolicy()
        self.resource_pressure = ResourcePressure()
        self.layer_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self.unknown_since: dict[str, float] = {}
        self.last_core_evidence: list[dict[str, Any]] = []
        self.connection_generation: tuple[Any, ...] | None = None
        self.subscription_probe_cache: tuple[str, float, dict[str, Any]] | None = None
        self.monthly_traffic_cache: tuple[int, str, str, list[dict[str, Any]]] | None = None
        self.resource_history_cache: tuple[int, dict[str, list[dict[str, Any]]]] | None = None
        self.connection_baseline: dict[str, tuple[float, int, int]] = {}
        self.system_cache: dict[str, Any] | None = None
        self.runtime_cache: dict[str, Any] = {
            "hy2": {"available": False, "traffic": {}, "online": {}, "streams": []},
            "singbox": {"available": False, "traffic": {}, "connections": [], "inventory": {}},
            "network": [], "subscription": {"configured": False, "ready": False, "count": 0},
            "services": [], "integrations": [], "alerts": [], "observedAt": None,
        }
        saved_targets = storage.get_setting("network_targets", None)
        has_saved_targets = isinstance(saved_targets, list) and bool(saved_targets)
        if has_saved_targets:
            config.network_targets = self._normalize_network_targets(saved_targets, restore=True)
        overrides = storage.get_setting("integration_overrides", {})
        overrides = self._migrate_traffic_quota(overrides)
        sanitized_legacy_secrets = False
        if isinstance(overrides, dict):
            for integration_id, value in overrides.items():
                if integration_id in config.integrations and isinstance(value, dict):
                    values = value.get("values", {})
                    if isinstance(values, dict) and "secret" in values:
                        values = dict(values)
                        values.pop("secret", None)
                        value = {**value, "values": values}
                        overrides[integration_id] = value
                        sanitized_legacy_secrets = True
                    if integration_id in {"hysteria2", *PROTOCOLS} and isinstance(values, dict) and values.get("endpoint"):
                        try:
                            values["endpoint"] = normalize_loopback_endpoint(str(values["endpoint"]))
                        except ValueError:
                            values = dict(values)
                            values.pop("endpoint", None)
                            value = {**value, "values": values, "configured": False, "status": "pending"}
                            overrides[integration_id] = value
                            sanitized_legacy_secrets = True
                    config.integrations[integration_id].update(value)
                    if isinstance(values, dict) and not (integration_id == "network" and has_saved_targets):
                        self._apply_integration_values(integration_id, {key: str(item) for key, item in values.items()})
                        if integration_id == "network" and self.config.network_targets:
                            storage.set_setting("network_targets", self.config.network_targets)
        if sanitized_legacy_secrets:
            storage.set_setting("integration_overrides", overrides)
            storage.add_audit("清理旧版接入密钥", "配置", "已从 SQLite 覆盖项中移除 v1.2 遗留的明文 Secret")
        if has_saved_targets:
            self._persist_network_targets(config.network_targets)
        for alert in storage.active_alerts():
            if str(alert["id"]).startswith("network-") and not str(alert["id"]).startswith("network-probe-"):
                target_id = str(alert["id"])[8:]
                target = next((item for item in self.config.network_targets if item["id"] == target_id), {})
                signature = (float(target.get("latencyMs", self.config.alert_thresholds["latencyMs"])), float(target.get("lossPercent", self.config.alert_thresholds["lossPercent"])))
                self.network_policy.states[target_id] = {"confirmed": True, "good": 0, "policy": signature}

    def _apply_quota_state_to_config(self, state: dict[str, Any]) -> None:
        self.config.traffic_limit_bytes = int(state["bytes"])
        self.config.traffic_billing_timezone = str(state["timezone"])
        self.config.traffic_count_mode = str(state["countMode"])
        try:
            self.config.traffic_billing_day = date.fromisoformat(str(state["resetAnchor"])).day
        except ValueError:
            self.config.traffic_billing_day = 1
        cycle_start, _, _ = traffic_quota_period(datetime.now(timezone.utc), state)
        baseline = baseline_for_cycle(state, cycle_start)
        self.config.traffic_initial_used_bytes = baseline
        self.config.traffic_initial_used_cycle = cycle_start.date().isoformat() if baseline else ""

    @staticmethod
    def _without_legacy_quota_values(overrides: Any) -> dict[str, Any]:
        cleaned = copy.deepcopy(overrides) if isinstance(overrides, dict) else {}
        traffic = cleaned.get("traffic")
        if isinstance(traffic, dict) and isinstance(traffic.get("values"), dict):
            values = dict(traffic["values"])
            for key in ("quotaGb", "billingDay", "billingTimezone", "initialUsedGb", "initialUsedCycle", "countMode"):
                values.pop(key, None)
            traffic["values"] = values
        return cleaned

    def _migrate_traffic_quota(self, overrides: Any) -> dict[str, Any]:
        original = overrides if isinstance(overrides, dict) else {}
        traffic = original.get("traffic", {}) if isinstance(original.get("traffic", {}), dict) else {}
        values = traffic.get("values", {}) if isinstance(traffic.get("values", {}), dict) else {}
        stored = self.storage.get_setting("traffic_quota", None)
        raw = dict(stored) if isinstance(stored, dict) else {}
        legacy_limit = self.storage.get_setting("traffic_limit_bytes", None)
        default_bytes = self.config.traffic_limit_bytes
        if isinstance(legacy_limit, (int, float)):
            default_bytes = int(legacy_limit)
        elif str(values.get("quotaGb", "")).strip():
            try:
                default_bytes = round(number(values["quotaGb"], "quotaGb") * 1_000_000_000)
            except (TypeError, ValueError):
                pass
        raw.setdefault("bytes", default_bytes)
        raw.setdefault("countMode", str(values.get("countMode") or self.config.traffic_count_mode))
        legacy_day = self.config.traffic_billing_day
        try:
            legacy_day = max(1, min(int(values.get("billingDay", legacy_day)), 28))
        except (TypeError, ValueError):
            pass
        legacy_timezone = str(values.get("billingTimezone") or self.config.traffic_billing_timezone)
        try:
            legacy_initial_bytes = max(0, round(float(values.get("initialUsedGb", 0) or 0) * 1_000_000_000))
        except (TypeError, ValueError):
            legacy_initial_bytes = max(0, int(self.config.traffic_initial_used_bytes))
        if not isinstance(stored, dict) and any(str(values.get(key, "")).strip() for key in ("billingDay", "billingTimezone", "initialUsedGb")):
            raw.update({
                "autoReset": True,
                "periodUnit": "month",
                "periodCount": 1,
                "resetAnchor": f"2000-01-{legacy_day:02d}",
                "resetTime": "00:00",
                "timezone": legacy_timezone,
            })
        state = normalize_quota_state(
            raw,
            default_bytes=default_bytes,
            legacy_day=legacy_day,
            legacy_timezone=legacy_timezone,
            legacy_count_mode=str(values.get("countMode") or self.config.traffic_count_mode),
            legacy_initial_bytes=legacy_initial_bytes,
            legacy_initial_cycle=str(values.get("initialUsedCycle") or self.config.traffic_initial_used_cycle),
        )
        if legacy_initial_bytes and not state["baseline"]["cycleStart"]:
            cycle_start, _, _ = traffic_quota_period(datetime.now(timezone.utc), state)
            state["baseline"] = {
                "bytes": legacy_initial_bytes,
                "cycleStart": utc_cycle_id(cycle_start),
            }
        self.storage.set_setting("traffic_quota", state)
        self.storage.delete_setting("traffic_limit_bytes")
        cleaned = self._without_legacy_quota_values(original)
        if cleaned != original:
            self.storage.set_setting("integration_overrides", cleaned)
        self._apply_quota_state_to_config(state)
        return cleaned

    def traffic_quota_state(self) -> dict[str, Any]:
        return normalize_quota_state(
            self.storage.get_setting("traffic_quota", {}),
            default_bytes=self.config.traffic_limit_bytes,
            legacy_day=self.config.traffic_billing_day,
            legacy_timezone=self.config.traffic_billing_timezone,
            legacy_count_mode=self.config.traffic_count_mode,
        )

    def update_traffic_quota(self, values: dict[str, Any], *, wizard: bool = False) -> dict[str, Any]:
        state = self.traffic_quota_state()
        candidate = dict(state)
        if "bytes" in values:
            quota_bytes = integer(values["bytes"], "bytes")
        elif str(values.get("quotaGb", "")).strip():
            quota_bytes = round(number(values["quotaGb"], "quotaGb") * 1_000_000_000)
        else:
            quota_bytes = int(state["bytes"])
        if not 1_000_000_000 <= quota_bytes <= 1_000_000_000_000_000:
            raise ValueError("Traffic limit must be between 1 GB and 1 PB")
        candidate["bytes"] = quota_bytes

        has_legacy_cycle = wizard and any(str(values.get(key, "")).strip() for key in ("billingDay", "billingTimezone"))
        auto_reset = boolean(values.get("autoReset", True if has_legacy_cycle else state["autoReset"]), "autoReset")
        period_unit = "month" if has_legacy_cycle else str(values.get("periodUnit", state["periodUnit"]))
        if period_unit not in {"day", "week", "month", "year"}:
            raise ValueError("periodUnit must be day, week, month, or year")
        period_count = 1 if has_legacy_cycle else integer(values.get("periodCount", state["periodCount"]), "periodCount")
        if not 1 <= period_count <= 365:
            raise ValueError("periodCount must be between 1 and 365")
        timezone_name = validate_timezone(values.get("billingTimezone") if has_legacy_cycle else values.get("timezone", state["timezone"]))
        if has_legacy_cycle:
            billing_day = integer(values.get("billingDay", self.config.traffic_billing_day), "billingDay")
            if not 1 <= billing_day <= 28:
                raise ValueError("Billing day must be between 1 and 28")
            reset_anchor = date(2000, 1, billing_day)
            reset_time = "00:00"
        else:
            try:
                reset_anchor = date.fromisoformat(str(values.get("resetAnchor", state["resetAnchor"])))
            except ValueError as error:
                raise ValueError("resetAnchor must use YYYY-MM-DD") from error
            reset_time = str(values.get("resetTime", state["resetTime"])).strip()
            try:
                datetime.strptime(reset_time, "%H:%M")
            except ValueError as error:
                raise ValueError("resetTime must use 24-hour HH:MM") from error
        candidate.update({
            "autoReset": auto_reset,
            "periodUnit": period_unit,
            "periodCount": period_count,
            "resetAnchor": reset_anchor.isoformat(),
            "resetTime": reset_time,
            "timezone": timezone_name,
        })
        if auto_reset:
            candidate.pop("fixedCycleStart", None)
        elif not bool(state["autoReset"]):
            candidate["fixedCycleStart"] = str(state.get("fixedCycleStart") or state["resetAnchor"])
        else:
            previous_start, _, _ = traffic_quota_period(datetime.now(timezone.utc), state)
            candidate["fixedCycleStart"] = utc_cycle_id(previous_start)
        count_mode = str(values.get("countMode", state["countMode"]))
        if count_mode not in {"sum", "max"}:
            raise ValueError("countMode must be sum or max")
        candidate["countMode"] = count_mode
        normalized = normalize_quota_state(candidate, default_bytes=quota_bytes)
        if "initialUsedGb" in values and str(values.get("initialUsedGb", "")).strip():
            initial_bytes = round(number(values["initialUsedGb"], "initialUsedGb") * 1_000_000_000)
            if not 0 <= initial_bytes <= 1_000_000_000_000_000:
                raise ValueError("Initial traffic usage must be between 0 and 1 PB")
            cycle_start, _, _ = traffic_quota_period(datetime.now(timezone.utc), normalized)
            normalized["baseline"] = {"bytes": initial_bytes, "cycleStart": utc_cycle_id(cycle_start)}
        self.storage.set_setting("traffic_quota", normalized)
        self.storage.set_setting("traffic_quota_confirmed", True)
        overrides = self._without_legacy_quota_values(self.storage.get_setting("integration_overrides", {}))
        self.storage.set_setting("integration_overrides", overrides)
        self._apply_quota_state_to_config(normalized)
        with self.lock:
            self.system_cache = None
        self.monthly_traffic_cache = None
        return normalized

    def _apply_integration_values(self, integration_id: str, values: dict[str, str]) -> None:
        if integration_id == "system":
            node_name = values.get("nodeName", "").strip()
            if node_name:
                if len(node_name) > 80:
                    raise ValueError("Node name must be at most 80 characters")
                self.config.node_name = node_name
        elif integration_id == "hysteria2":
            if values.get("endpoint", "").strip():
                self.config.hysteria_api.update({"url": values["endpoint"]})
            if "identityMappings" in values:
                self._apply_hysteria_identity_mappings(values.get("identityMappings", ""))
        elif integration_id in {"anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"}:
            if values.get("endpoint", "").strip():
                self.config.singbox_api.update({"url": values["endpoint"]})
            if "inboundTags" in values:
                tags = [tag.strip() for tag in values["inboundTags"].split(",") if tag.strip()]
                adapter = {"inboundTags": tags}
                if integration_id == "vless":
                    adapter["securityProfile"] = values.get("securityProfile", "standard")
                self.config.protocol_adapters[integration_id] = adapter
        elif integration_id == "traffic":
            if "interface" in values:
                interface = values["interface"].strip()
                if interface:
                    interface = validate_interface_name(interface)
                self.system_collector.configure_interface(interface)
            if any(key in values for key in ("quotaGb", "billingDay", "billingTimezone", "initialUsedGb", "countMode")):
                quota_values = values if not self.storage.get_setting("traffic_quota_confirmed", False) else {key: value for key, value in values.items() if key == "countMode"}
                if quota_values:
                    self.update_traffic_quota(quota_values, wizard=True)
        elif integration_id == "subscriptions":
            # Subscription addresses remain in protected configuration. The
            # browser value is accepted only as a one-time live probe.
            pass
        elif integration_id == "network" and values.get("targets", "").strip():
            targets: list[dict[str, Any]] = []
            for index, line in enumerate(self._network_target_lines(values["targets"])):
                name, address = self._network_target_parts(line)
                address, version = validate_probe_target(address)
                previous = next((item for item in self.config.network_targets if item.get("address") == address), {})
                targets.append({**previous, "name": name or address, "provider": "Custom", "address": address, "ipVersion": previous.get("ipVersion", version), "order": index + 1})
            if not targets:
                raise ValueError("At least one valid network target is required")
            self.config.network_targets = self._normalize_network_targets(targets)
            self._invalidate_network()
        elif integration_id == "alerts":
            self.config.alert_thresholds = self._alert_thresholds_from_values(values)

    def configure_integration(self, integration_id: str, payload: dict[str, Any], source_ip: str = "127.0.0.1", actor: str = "system") -> dict[str, Any]:
        allowed_fields = {
            "hysteria2": {"endpoint", "identityMappings"},
            "anytls": {"endpoint", "inboundTags"},
            "vless": {"endpoint", "inboundTags", "securityProfile"},
            "socks5": {"endpoint", "inboundTags"},
            "shadowsocks": {"endpoint", "inboundTags"},
            "vmess": {"endpoint", "inboundTags"},
            "trojan": {"endpoint", "inboundTags"},
            "tuic": {"endpoint", "inboundTags"},
            "traffic": {"interface", "quotaGb", "billingDay", "billingTimezone", "initialUsedGb", "countMode"},
            "connections": set(),
            "subscriptions": {"baseUrl"},
            "network": {"targets"},
            "alerts": {"trafficPercent", "latencyMs", "lossPercent"},
            "audit": set(),
            "system": {"nodeName"},
        }
        if integration_id not in allowed_fields:
            raise ValueError("Unknown integration")
        values = payload.get("values", {})
        if not isinstance(values, dict):
            raise ValueError("Integration values must be an object")
        clean_values: dict[str, str] = {}
        for key, value in values.items():
            if key not in allowed_fields[integration_id]:
                continue
            if isinstance(value, (dict, list, tuple, set)) or value is None:
                raise ValueError(f"{key} must be a scalar value")
            text = str(value)
            limit = INTEGRATION_FIELD_LIMITS[key]
            if len(text) > limit:
                raise ValueError(f"{key} must be at most {limit} characters")
            clean_values[key] = text
        enabled = boolean(payload.get("enabled", True), "enabled")
        required = {
            "hysteria2": {"endpoint"},
            "anytls": {"endpoint", "inboundTags"},
            "vless": {"endpoint", "inboundTags", "securityProfile"},
            "socks5": {"endpoint", "inboundTags"},
            "shadowsocks": {"endpoint", "inboundTags"},
            "vmess": {"endpoint", "inboundTags"},
            "trojan": {"endpoint", "inboundTags"},
            "tuic": {"endpoint", "inboundTags"},
            "subscriptions": {"baseUrl"},
        }
        configured = required.get(integration_id, set()).issubset({key for key, value in clean_values.items() if value.strip()})
        if integration_id == "subscriptions":
            configured = bool(clean_values.get("baseUrl", "").strip() or self.config.subscription_base_url or self.config.subscriptions)
        if integration_id not in required:
            configured = True
        try:
            if not configured:
                raise ValueError("Complete the required fields")
            self._validate_integration(integration_id, clean_values)
        except ValueError:
            # Keep a failed first setup visible without applying unverified
            # values or changing the shared core endpoint for other protocols.
            if integration_id in {"hysteria2", *PROTOCOLS} and not self.config.integrations.get(integration_id, {}).get("configured"):
                state = {"enabled": enabled, "configured": False, "attempted": True, "status": "error", "values": {}}
                overrides = self.storage.get_setting("integration_overrides", {})
                overrides[integration_id] = state
                self.storage.set_setting("integration_overrides", overrides)
                self.config.integrations.setdefault(integration_id, {}).update(state)
            raise
        summaries = {
            "hysteria2": "Endpoint, authentication, and account identity mappings validated",
            "anytls": "Endpoint saved; connectivity and authentication validated",
            "vless": "sing-box endpoint and VLESS inbound tags validated",
            "socks5": "sing-box endpoint and SOCKS5 inbound tags validated",
            "shadowsocks": "sing-box endpoint and Shadowsocks inbound tags validated",
            "vmess": "sing-box endpoint and VMess inbound tags validated",
            "trojan": "sing-box endpoint and Trojan inbound tags validated",
            "tuic": "sing-box endpoint and TUIC inbound tags validated",
            "subscriptions": "Subscription publisher returned a non-empty HTTPS response",
            "network": "Probe targets saved; runtime reachability is reported separately",
            "traffic": "Traffic sampling settings saved",
            "connections": "Connection view enabled; fields depend on configured protocol adapters",
            "alerts": "Alert thresholds saved",
            "audit": "Local audit recording enabled",
            "system": "Local system collection enabled",
        }
        summary = summaries.get(integration_id, "Configuration saved") if configured else "Complete the required fields"
        persisted_values = {} if integration_id == "subscriptions" else clean_values
        if integration_id == "traffic":
            persisted_values = {key: value for key, value in clean_values.items() if key == "interface"}
        self._apply_integration_values(integration_id, clean_values)
        if integration_id == "network":
            persisted_values = {"targets": self._network_targets_text(self.config.network_targets)}
        state = {"enabled": enabled, "configured": configured, "status": "ready" if configured else "pending", "summary": summary, "values": persisted_values}
        overrides = self.storage.get_setting("integration_overrides", {})
        overrides[integration_id] = state
        self.storage.set_setting("integration_overrides", overrides)
        self.config.integrations[integration_id].update(state)
        if integration_id == "network":
            self._persist_network_targets(self.config.network_targets, state)
        self.storage.add_audit("更新数据接入", "配置", f"{integration_id} 接入配置已更新", source_ip, actor=actor)
        return next(item for item in self.config.public_integrations() if item["id"] == integration_id)

    def _validate_integration(self, integration_id: str, values: dict[str, str]) -> None:
        if integration_id == "hysteria2":
            endpoint = normalize_loopback_endpoint(values["endpoint"])
            secret = str(self.config.hysteria_api.get("secret", "")).strip()
            if not secret or secret == "replace-on-server":
                raise ValueError("Configure the Hysteria2 Secret in the protected server config first")
            traffic = http_json(endpoint + "/traffic", secret, strict=True)
            online = http_json(endpoint + "/online", secret, strict=True)
            streams = http_json(endpoint + "/dump/streams", secret, strict=True)
            if not isinstance(traffic, dict) or not isinstance(online, dict) or not isinstance(streams, dict):
                raise ValueError("Hysteria2 validation endpoints returned an invalid response")
            mappings = self._parse_hysteria_identity_mappings(values.get("identityMappings", ""))
            reported = {str(value) for value in set(traffic) | set(online)}
            unknown = sorted({identity for identities in mappings.values() for identity in identities} - reported)
            if unknown:
                raise ValueError("One or more mapped Hysteria2 identities are not reported by the live API")
            values["endpoint"] = endpoint
        elif integration_id in {"anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"}:
            endpoint = normalize_loopback_endpoint(values["endpoint"])
            secret = str(self.config.singbox_api.get("secret", "")).strip()
            if not secret or secret == "replace-on-server":
                raise ValueError("Configure the sing-box Secret in the protected server config first")
            response = http_json(endpoint + "/connections", secret, bearer=True, strict=True)
            if not valid_singbox_payload(response):
                raise ValueError("sing-box connections endpoint returned an invalid response")
            values["endpoint"] = endpoint
            tags = [tag.strip() for tag in values.get("inboundTags", "").split(",") if tag.strip()]
            if not tags or len(tags) > 20 or any(len(tag) > 80 for tag in tags):
                raise ValueError("Provide 1-20 sing-box inbound tags, each at most 80 characters")
            if len({tag.casefold() for tag in tags}) != len(tags):
                raise ValueError("Inbound tags must be unique")
            values["inboundTags"] = ",".join(tags)
            if integration_id == "vless" and values.get("securityProfile") not in {"standard", "xtls-vision", "reality", "xtls-vision-reality"}:
                raise ValueError("Invalid VLESS security profile")
            other_protocols = any(key != integration_id and adapter.get("inboundTags") for key, adapter in self.config.protocol_adapters.items())
            if other_protocols and self.config.singbox_api.get("url") != endpoint:
                raise ValueError("Protocols sharing sing-box must use the same API endpoint")
            candidate = copy.deepcopy(self.config)
            candidate.singbox_api["url"] = endpoint
            candidate_adapter: dict[str, Any] = {"inboundTags": tags}
            if integration_id == "vless":
                candidate_adapter["securityProfile"] = values.get("securityProfile", "standard")
            candidate.protocol_adapters[integration_id] = candidate_adapter
            ready, reason, _reason_zh = protocol_readiness(candidate, integration_id, {"available": True, "inventory": read_protocol_inventory(candidate)})
            if not ready:
                raise ValueError(reason)
        elif integration_id == "subscriptions":
            candidate = values.get("baseUrl", "").strip()
            if candidate:
                probe_subscription_url(normalize_subscription_url(candidate))
            self.subscription_probe(self.config.subscription_base_url, force=True)
        elif integration_id == "network" and values.get("targets", "").strip():
            for line in self._network_target_lines(values["targets"]):
                _name, address = self._network_target_parts(line)
                validate_probe_target(address)
        elif integration_id == "traffic":
            if values.get("interface", "").strip():
                values["interface"] = validate_interface_name(values["interface"])
                statistics = Path("/sys/class/net") / values["interface"] / "statistics"
                if Path("/sys/class/net").is_dir() and not all((statistics / name).is_file() for name in ("rx_bytes", "tx_bytes")):
                    raise ValueError("Configured network interface does not expose readable traffic counters")
            if values.get("quotaGb", "").strip():
                quota = number(values["quotaGb"], "quotaGb")
                if not 1 <= quota <= 1_000_000:
                    raise ValueError("quotaGb must be between 1 and 1000000 decimal GB")
            if values.get("billingDay", "").strip() and not 1 <= int(values["billingDay"]) <= 28:
                raise ValueError("billingDay must be between 1 and 28")
            if values.get("billingTimezone", "").strip():
                timezone_name = values["billingTimezone"].strip()
                if timezone_name != "UTC":
                    try:
                        ZoneInfo(timezone_name)
                    except ZoneInfoNotFoundError as error:
                        raise ValueError("billingTimezone must be UTC or an installed IANA timezone") from error
            if values.get("initialUsedGb", "").strip():
                baseline = number(values["initialUsedGb"], "initialUsedGb")
                if not 0 <= baseline <= 1_000_000:
                    raise ValueError("initialUsedGb must be between 0 and 1000000 decimal GB")
            if values.get("countMode", "").strip() not in {"", "sum", "max"}:
                raise ValueError("countMode must be sum or max")
            if not self.storage.is_writable():
                raise ValueError("Traffic sampling storage is unavailable or read-only")
        elif integration_id == "alerts":
            self._alert_thresholds_from_values(values)
            if not self.storage.is_writable():
                raise ValueError("Alert storage is unavailable or read-only")
        elif integration_id in {"system", "audit"}:
            if not self.storage.is_writable():
                raise ValueError("Panel storage is unavailable or read-only")
            if integration_id == "system" and Path("/proc/stat").is_file():
                snapshot = self.system_collector.snapshot()
                if not snapshot.get("kernel") or not snapshot.get("memoryTotalBytes"):
                    raise ValueError("Host metrics are unavailable")

    @staticmethod
    def _network_target_lines(value: str) -> list[str]:
        lines = [line for line in value.splitlines() if line.strip()]
        if len(lines) > 12:
            raise ValueError("Network targets must contain at most 12 non-empty lines")
        return lines

    def _alert_thresholds_from_values(self, values: dict[str, str]) -> dict[str, float]:
        candidate = dict(self.config.alert_thresholds)
        for key in ("trafficPercent", "latencyMs", "lossPercent"):
            raw = values.get(key, "").strip()
            if not raw:
                continue
            try:
                candidate[key] = float(raw)
            except ValueError as error:
                raise ValueError(f"{key} must be a finite number") from error
        return normalize_alert_thresholds(candidate)

    @staticmethod
    def _network_target_parts(line: str) -> tuple[str, str]:
        text = line.strip()
        for separator in ("|", ","):
            if separator in text:
                name, address = (part.strip() for part in text.split(separator, 1))
                if not name or not address:
                    raise ValueError("Network target must use 'name,address' or a plain address")
                if len(name) > 60:
                    raise ValueError("Network target name must be at most 60 characters")
                return name, address
        return "", text

    def _parse_hysteria_identity_mappings(self, value: str) -> dict[str, list[str]]:
        mappings: dict[str, list[str]] = {}
        known_accounts = {
            candidate: str(account.get("id", ""))
            for account in self.config.managed_accounts
            for candidate in (str(account.get("id", "")).strip(), str(account.get("name", "")).strip())
            if candidate
        }
        assigned: set[str] = set()
        for raw_line in value.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if "=" not in line:
                raise ValueError("Identity mappings must use 'managed account=protocol identity'")
            account_key, raw_identities = (part.strip() for part in line.split("=", 1))
            account_id = known_accounts.get(account_key)
            identities = [item.strip() for item in raw_identities.split(",") if item.strip()]
            if not account_id or not identities:
                raise ValueError("Identity mapping references an unknown account or has no protocol identity")
            if len(identities) > 20 or any(len(item) > 160 for item in identities):
                raise ValueError("Each account can map 1-20 protocol identities of at most 160 characters")
            if any(identity in assigned for identity in identities):
                raise ValueError("A protocol identity can map to only one managed account")
            assigned.update(identities)
            mappings.setdefault(account_id, []).extend(identities)
        return mappings

    def _apply_hysteria_identity_mappings(self, value: str) -> None:
        mappings = self._parse_hysteria_identity_mappings(value)
        for account in self.config.managed_accounts:
            current = account.get("trafficIdentities", {})
            if not isinstance(current, dict):
                current = {}
            current = dict(current)
            account_id = str(account.get("id", ""))
            if account_id in mappings:
                current["hysteria2"] = mappings[account_id]
            else:
                current.pop("hysteria2", None)
            account["trafficIdentities"] = current

    def subscription_probe(self, candidate_base_url: str | None = None, *, force: bool = False) -> dict[str, Any]:
        protected_urls = [
            str(item.get("url", "")).strip()
            for item in self.config.subscriptions
            if item.get("enabled", True) and str(item.get("url", "")).strip()
        ]
        urls = protected_urls or ([candidate_base_url.strip()] if candidate_base_url and candidate_base_url.strip() else [])
        fingerprint = hashlib.sha256("\n".join(urls).encode()).hexdigest()
        if not force and self.subscription_probe_cache and self.subscription_probe_cache[0] == fingerprint and self.subscription_probe_cache[1] > time.monotonic():
            return dict(self.subscription_probe_cache[2])
        if not urls:
            result = {"configured": False, "ready": False, "count": 0, "reachable": 0, "parseable": 0, "formats": [], "validationLevel": "not-configured"}
        else:
            outcomes: list[dict[str, Any]] = []
            deadline = time.monotonic() + 8
            def inspect(url: str) -> dict[str, Any]:
                from .security import PublicFetchBusy
                try:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise PublicFetchBusy("Subscription check deadline exceeded")
                    parsed = probe_subscription_url(url, timeout=min(3, remaining))
                    evidence = dict(parsed) if isinstance(parsed, dict) else {"format": "unknown", "nodeCount": 0}
                    return {**evidence, "reachable": True, "parseable": True, "checked": True}
                except PublicFetchBusy:
                    return {"reachable": False, "parseable": False, "checked": False}
                except ValueError as error:
                    return {"reachable": bool(getattr(error, "reachable", False)), "parseable": False, "checked": True}
            limited_urls = urls[:50]
            with ThreadPoolExecutor(max_workers=min(4, len(limited_urls)), thread_name_prefix="subscription") as pool:
                outcomes = list(pool.map(inspect, limited_urls))
            parsed = [item for item in outcomes if item["parseable"]]
            checked = sum(bool(item["checked"]) for item in outcomes)
            result = {"configured": True, "ready": len(parsed) == len(urls), "count": len(urls),
                      "checkedCount": checked, "unverifiedCount": len(urls) - checked,
                      "partial": checked < len(urls), "reason": "local_budget_or_limit" if checked < len(urls) else "checked",
                      "reachable": sum(1 for item in outcomes if item["reachable"]), "parseable": len(parsed),
                      "formats": sorted({str(item["format"]) for item in parsed}),
                      "validationLevel": "reachability-and-format-only"}
        self.subscription_probe_cache = (fingerprint, time.monotonic() + 60, dict(result))
        if force and result["configured"] and not result["ready"]:
            if result.get("partial"):
                from .security import PublicFetchBusy
                raise PublicFetchBusy("Subscription checks incomplete due to local capacity or limit")
            raise ValueError("Subscription publisher validation failed")
        return result

    def _invalidate_network(self) -> None:
        with self.lock:
            self.network_generation += 1
            self.network_series.clear()
            self.network_time_cache.clear()
            self.network_recorded_monotonic = 0.0
            self.runtime_cache["network"] = [
                {**item, "latency": None, "loss": None, "jitter": None,
                 "history": [], "probeHistory": [], "sampleIntervalSeconds": 1, "status": "unavailable", "measurementStatus": "unavailable",
                 "probeReason": "pending", "observedAt": None}
                for item in self.config.network_targets
            ]
            self.collection_state["network"] = {"observedAt": None, "error": "pending"}

    def update_network_targets(self, payload: Any, source_ip: str, actor: str, global_thresholds: Any = None) -> list[dict[str, Any]]:
        targets = self._normalize_network_targets(payload)
        with self.lock:
            thresholds = None
            if global_thresholds is not None:
                if not isinstance(global_thresholds, dict) or set(global_thresholds) != {"latencyMs", "lossPercent"}:
                    raise ValueError("Global network rules require latencyMs and lossPercent")
                thresholds = self._alert_thresholds_from_values({key: str(number(value, key)) for key, value in global_thresholds.items()})
            self._persist_network_targets(targets, global_thresholds=thresholds)
            self.config.network_targets = targets
            self._invalidate_network()
        self.storage.add_audit("更新网络探测目标", "配置", f"已保存 {len(targets)} 个探测目标", source_ip, actor=actor)
        return targets

    def _normalize_network_targets(self, payload: Any, *, restore: bool = False) -> list[dict[str, Any]]:
        if not isinstance(payload, list) or not 1 <= len(payload) <= 12:
            raise ValueError("Configure between 1 and 12 network targets")
        targets: list[dict[str, Any]] = []
        seen_addresses: set[str] = set()
        existing = {item["address"]: item for item in self.config.network_targets}
        for index, item in enumerate(payload):
            if not isinstance(item, dict):
                raise ValueError("Each network target must be an object")
            name = str(item.get("name", "")).strip()
            if not name or len(name) > 60:
                raise ValueError("Network target name must contain 1-60 characters")
            address, version = validate_probe_target(str(item.get("address", "")))
            if address in seen_addresses:
                raise ValueError("Network target addresses must be unique")
            seen_addresses.add(address)
            try:
                order = int(item.get("order", index + 1))
            except (TypeError, ValueError) as error:
                raise ValueError("Network target order must be an integer") from error
            stable_id = (item if restore else existing.get(address, {})).get("id", "")
            if not isinstance(stable_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", stable_id):
                stable_id = "custom-" + hashlib.sha256(address.encode("utf-8")).hexdigest()[:16]
            targets.append({
                "id": stable_id,
                "name": name,
                "provider": "Custom",
                "address": address,
                "ipVersion": version if ":" in address or all(part.isdigit() for part in address.split(".")) else integer(item.get("ipVersion", 0), "ipVersion"),
                "order": max(1, min(order, 999)),
            })
            for key, minimum, maximum in (("tcpPort", 1, 65535), ("dnsPort", 1, 65535)):
                if key in item:
                    value = number(item[key], key)
                    if not minimum <= value <= maximum or (key.endswith("Port") and value != int(value)):
                        raise ValueError("Invalid network probe policy")
                    targets[-1][key] = int(value) if key.endswith("Port") else value
            if "dnsPort" in item or str(item.get("dnsName", "")).strip():
                targets[-1].setdefault("dnsPort", 53)
                try:
                    ipaddress.ip_address(address)
                except ValueError as error:
                    raise ValueError("DNS resolver probe requires a numeric public IP") from error
                dns_name = str(item.get("dnsName") or "example.com").strip()
                if not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?", dns_name) or any(not 1 <= len(label) <= 63 for label in dns_name.split(".")):
                    raise ValueError("Invalid DNS probe name")
                targets[-1]["dnsName"] = dns_name
        if any(item["ipVersion"] not in {0, 4, 6} for item in targets):
            raise ValueError("ipVersion must be 0 (auto), 4, or 6")
        if len({item["id"] for item in targets}) != len(targets):
            raise ValueError("Network target IDs must be unique")
        targets.sort(key=lambda item: (item["order"], item["name"].casefold()))
        for index, item in enumerate(targets, 1):
            item["order"] = index
        return targets

    @staticmethod
    def _network_targets_text(targets: list[dict[str, Any]]) -> str:
        return "\n".join(f"{item['name']},{item['address']}" for item in targets)

    def _persist_network_targets(self, targets: list[dict[str, Any]], state: dict[str, Any] | None = None, global_thresholds: dict[str, float] | None = None) -> None:
        """Keep the editor, wizard and runtime configuration on one canonical value."""
        overrides = self.storage.get_setting("integration_overrides", {})
        if not isinstance(overrides, dict):
            overrides = {}
        current = dict(overrides.get("network", {})) if isinstance(overrides.get("network"), dict) else {}
        current.update(state or {})
        current.update({
            "enabled": bool(current.get("enabled", True)),
            "configured": bool(targets),
            "status": "ready" if targets else "pending",
            "summary": "Probe targets saved; runtime reachability is reported separately" if targets else "Complete the required fields",
            "values": {"targets": self._network_targets_text(targets)},
        })
        overrides["network"] = current
        if global_thresholds is not None:
            alert_state = {**self.config.integrations.get("alerts", {}), **overrides.get("alerts", {}),
                           "configured": True, "values": {key: str(value) for key, value in global_thresholds.items()}}
            overrides["alerts"] = alert_state
        self.storage.set_settings({"network_targets": targets, "integration_overrides": overrides})
        self.config.integrations.setdefault("network", {}).update(current)
        if global_thresholds is not None:
            self.config.alert_thresholds = global_thresholds
            self.config.integrations.setdefault("alerts", {}).update(overrides["alerts"])

    def traffic_series(self) -> dict[str, Any]:
        now = int(time.time())
        definitions = {"1h": (3600, 180), "6h": (6 * 3600, 900), "24h": (86400, 3600), "3day": (3 * 86400, 10800), "7day": (7 * 86400, 21600)}
        samples = self.storage.samples_since(now - 7 * 86400 - 300)

        def series(duration: int, interval: int) -> list[dict[str, Any]]:
            start = now - duration
            buckets: dict[int, dict[str, int]] = {}
            previous_by_source: dict[tuple[str, str], dict[str, Any]] = {}
            previous_source = None
            for sample in samples:
                source = (str(sample.get("interface") or "legacy"), str(sample.get("boot_id") or "legacy"))
                previous = previous_by_source.get(source)
                if previous is not None and sample["captured_at"] >= start:
                    bucket = (sample["captured_at"] // interval) * interval
                    item = buckets.setdefault(bucket, {"upload": 0, "download": 0, "gapBefore": False})
                    item["gapBefore"] = item["gapBefore"] or sample["captured_at"] - previous["captured_at"] > 300 or previous_source != source
                    item["upload"] += sample["tx_bytes"] if sample["tx_bytes"] < previous["tx_bytes"] else sample["tx_bytes"] - previous["tx_bytes"]
                    item["download"] += sample["rx_bytes"] if sample["rx_bytes"] < previous["rx_bytes"] else sample["rx_bytes"] - previous["rx_bytes"]
                previous_by_source[source] = sample
                previous_source = source
            result = []
            ordered_buckets = sorted(buckets.items())
            for captured_at, values in ordered_buckets:
                # A bucket represents the interval ending at this timestamp. The
                # current bucket ends at the snapshot time, so its final label can
                # agree with the clock shown by the browser instead of appearing
                # one whole bucket behind it.
                display_at = min(captured_at + interval, now)
                moment = datetime.fromtimestamp(display_at, timezone.utc)
                label = moment.strftime("%m/%d") if interval >= 86400 else moment.strftime("%m/%d %H:%M")
                result.append({"label": label, "capturedAt": moment.isoformat().replace("+00:00", "Z"), "intervalSeconds": interval, **values})
            return result

        ranges = {key: series(duration, interval) for key, (duration, interval) in definitions.items()}
        return {"ranges": ranges, "hourly": ranges["24h"], "daily": ranges["7day"]}

    @staticmethod
    def _month_start(moment: datetime, offset: int) -> datetime:
        month_index = moment.year * 12 + moment.month - 1 + offset
        year, zero_based_month = divmod(month_index, 12)
        return datetime(year, zero_based_month + 1, 1, tzinfo=moment.tzinfo)

    def monthly_traffic_usage(self) -> list[dict[str, Any]]:
        quota_state = self.traffic_quota_state()
        try:
            zone = ZoneInfo(str(quota_state["timezone"]))
        except ZoneInfoNotFoundError:
            zone = timezone.utc
        now = datetime.fromtimestamp(time.time(), timezone.utc).astimezone(zone)
        cache_minute = int(now.timestamp()) // 60
        count_mode = str(quota_state["countMode"])
        cache_key = (cache_minute, str(zone), count_mode)
        if self.monthly_traffic_cache and self.monthly_traffic_cache[:3] == cache_key:
            return copy.deepcopy(self.monthly_traffic_cache[3])

        result: list[dict[str, Any]] = []
        for offset in range(-5, 1):
            start = self._month_start(now, offset)
            end = self._month_start(now, offset + 1)
            usage = self.storage.traffic_usage_between(
                int(start.astimezone(timezone.utc).timestamp()),
                int(end.astimezone(timezone.utc).timestamp()),
                count_mode,
            )
            result.append({
                "startDate": start.date().isoformat(),
                "endDate": (end.date() - timedelta(days=1)).isoformat(),
                "bytes": int(usage["usedBytes"]),
                "coverage": usage["coverage"],
            })
        self.monthly_traffic_cache = (*cache_key, copy.deepcopy(result))
        return result

    @staticmethod
    def reconcile_breakdown(items: list[dict[str, Any]], total_bytes: int, fallback_name: str) -> list[dict[str, Any]]:
        """Preserve observed counters and expose only a real positive ledger remainder."""
        total_bytes = max(0, int(total_bytes))
        cleaned = [{**item, "value": max(0, int(item.get("value", 0)))} for item in items]
        raw_total = sum(item["value"] for item in cleaned)
        if raw_total == 0:
            return [{"name": fallback_name, "value": total_bytes}] if total_bytes else []
        if total_bytes > raw_total:
            cleaned.append({"name": fallback_name, "value": total_bytes - raw_total})
        return cleaned

    def account_metrics(self, accounts: list[dict[str, Any]], hy2: dict[str, Any], _total_bytes: int) -> list[dict[str, Any]]:
        traffic = hy2.get("traffic", {}) if isinstance(hy2.get("traffic"), dict) else {}
        online = hy2.get("online", {}) if isinstance(hy2.get("online"), dict) else {}
        identities = set(traffic) | set(online)
        assigned: set[str] = set()
        mappings: list[list[str]] = []
        for account in accounts:
            configured = account.get("trafficIdentities", [])
            if isinstance(configured, dict):
                configured = configured.get("hysteria2", [])
            if not isinstance(configured, list):
                configured = []
            candidates = [str(value) for value in configured]
            matches = [candidate for candidate in candidates if candidate and candidate in identities and candidate not in assigned]
            assigned.update(matches)
            mappings.append(matches)
        public_accounts: list[dict[str, Any]] = []
        for account, mapped_identities in zip(accounts, mappings):
            core_used = sum(int(traffic.get(identity, {}).get("tx", 0)) + int(traffic.get(identity, {}).get("rx", 0)) for identity in mapped_identities)
            configured_status = str(account.get("status", "")).strip().lower()
            if configured_status not in {"active", "disabled"}:
                configured_status = "unknown"
            expires_at = str(account.get("expiresAt", ""))[:80]
            expiry_status = "notConfigured"
            if expires_at:
                try:
                    expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                    if expiry.tzinfo is None:
                        expiry = expiry.replace(tzinfo=timezone.utc)
                    remaining = (expiry.astimezone(timezone.utc) - datetime.now(timezone.utc)).total_seconds()
                    expiry_status = "expired" if remaining <= 0 else "expiring" if remaining <= 30 * 86400 else "valid"
                except ValueError:
                    expiry_status = "unknown"
            core_available = bool(hy2.get("available") or traffic or online)
            core_evidence = "observed" if mapped_identities else "notObserved" if candidates and core_available else "unavailable" if candidates else "unknown"
            status = "disabled" if configured_status == "disabled" else "expired" if expiry_status == "expired" else "expiring" if expiry_status == "expiring" else "registered" if configured_status == "active" else "unknown"
            public_accounts.append({
                "id": str(account.get("id", ""))[:160],
                "name": str(account.get("name", "account"))[:160],
                "email": str(account.get("email", ""))[:254],
                "status": status,
                "configuredStatus": configured_status,
                "expiryStatus": expiry_status,
                "coreEvidence": core_evidence,
                "protocols": [str(value)[:80] for value in account.get("protocols", [])[:20]] if isinstance(account.get("protocols", []), list) else [],
                "expiresAt": expires_at,
                "usedBytes": core_used,
                "usageSource": "protocolCounter" if mapped_identities else "unmapped",
                "onlineDevices": sum(int(online.get(identity, 0)) for identity in mapped_identities),
                "quotaBytes": int(self.traffic_quota_state()["bytes"]),
            })
        return public_accounts

    def aggregate_connections(self, raw_connections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        now = time.monotonic()
        current: dict[str, tuple[float, int, int]] = {}
        groups: dict[tuple[str, str, str], dict[str, Any]] = {}
        for item in raw_connections:
            connection_id = f"{item['protocol']}\0{item['id']}\0{item.get('connectedAt') or ''}"
            uploaded = int(item.get("uploadedBytes", 0)); downloaded = int(item.get("downloadedBytes", 0))
            previous = self.connection_baseline.get(connection_id)
            upload_rate = download_rate = None
            if previous and now > previous[0] and uploaded >= previous[1] and downloaded >= previous[2]:
                elapsed = now - previous[0]
                upload_rate = round((uploaded - previous[1]) / elapsed)
                download_rate = round((downloaded - previous[2]) / elapsed)
            current[connection_id] = (now, uploaded, downloaded)
            detail = {**item, "uploadBps": upload_rate, "downloadBps": download_rate}
            key = (str(item["protocol"]), str(item["account"]), str(item["sourceIp"]))
            if key not in groups:
                groups[key] = {"id": self.connection_group_id(key), "protocol": key[0], "account": key[1], "sourceIp": key[2], "ipVersion": item.get("ipVersion"), "connections": 0, "uploadBps": 0, "downloadBps": 0, "connectedAt": item.get("connectedAt"), "uploadedBytes": 0, "downloadedBytes": 0, "details": [], "knownRates": 0}
            group = groups[key]
            group["connections"] += 1
            group["uploadedBytes"] += uploaded; group["downloadedBytes"] += downloaded
            group["details"].append(detail)
            if item.get("connectedAt") and (not group["connectedAt"] or str(item["connectedAt"]) < str(group["connectedAt"])):
                group["connectedAt"] = item["connectedAt"]
            if upload_rate is not None and download_rate is not None:
                group["knownRates"] += 1
                group["uploadBps"] += upload_rate; group["downloadBps"] += download_rate
        self.connection_baseline = current
        for group in groups.values():
            known_rates = int(group.pop("knownRates"))
            total_rates = int(group["connections"])
            if known_rates == 0:
                group["uploadBps"] = None; group["downloadBps"] = None
            group["ratesPartial"] = 0 < known_rates < total_rates
            group["rateCoverage"] = {"known": known_rates, "total": total_rates}
        return list(groups.values())

    @staticmethod
    def connection_group_id(key: tuple[str, str, str]) -> str:
        import json
        return "group-" + hashlib.sha256(json.dumps(key, ensure_ascii=True).encode()).hexdigest()[:24]

    def with_online_clients(self, groups: list[dict[str, Any]], hy2: dict[str, Any]) -> list[dict[str, Any]]:
        """/online counts clients, including clients without a listed TCP stream."""
        if not hy2.get("endpointStatus", {}).get("online", hy2.get("available")):
            return groups
        for account, count in hy2.get("online", {}).items():
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                continue
            matches = [g for g in groups if g["protocol"] == "Hysteria2" and g["account"] == account]
            # Do not distribute one identity's client count over inferred sources.
            if len(matches) > 1:
                continue
            if matches:
                matches[0]["onlineClients"] = count
            elif count:
                key = ("Hysteria2", str(account), "")
                groups.append({"id": self.connection_group_id(key), "protocol": key[0], "account": key[1], "sourceIp": "", "ipVersion": None, "connections": 0, "entriesAvailable": bool(hy2.get("endpointStatus", {}).get("streams", hy2.get("available"))), "onlineClients": count, "uploadBps": None, "downloadBps": None, "connectedAt": None, "details": []})
        return groups

    def connection_targets(self) -> dict[str, Any]:
        """Explicit authenticated, in-memory view; never persist destinations."""
        with self.lock:
            freshness = self.collection_freshness()
            live = freshness["runtime"]["status"] == "live"
            groups = []
            for group in self.runtime_cache.get("connections", []):
                source = "hysteria2" if group["protocol"] == "Hysteria2" else "singbox"
                core = self.runtime_cache["hy2" if source == "hysteria2" else "singbox"]
                if not live or freshness[source]["status"] != "live" or not core.get("available"):
                    continue
                details = [{"id": d["id"], "destination": d["destination"]} for d in group.get("details", []) if d.get("destination")]
                if details:
                    groups.append({"id": group["id"], "details": details})
            return {"groups": groups, "sampledAt": self.runtime_cache.get("observedAt"), "available": live and bool(groups)}

    def alerts(self, system: dict[str, Any], services: list[dict[str, Any]], network: list[dict[str, Any]], integrations: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        alerts: list[dict[str, Any]] = []
        previous_alerts = self.storage.active_alerts()
        unresolved_ids = {str(item["id"]) for item in previous_alerts}
        usage = 100 * system["trafficUsedBytes"] / max(1, system["trafficLimitBytes"])
        traffic_threshold = float(self.config.alert_thresholds.get("trafficPercent", 80))
        latency_threshold = float(self.config.alert_thresholds.get("latencyMs", 150))
        loss_threshold = float(self.config.alert_thresholds.get("lossPercent", 5))
        if usage >= traffic_threshold:
            alerts.append({"id": "traffic-threshold", "severity": "critical" if usage >= max(95, traffic_threshold + 10) else "warning", "title": f"Traffic usage reached {usage:.0f}%", "titleEn": f"Traffic usage reached {usage:.0f}%", "titleZh": f"流量使用已达到 {usage:.0f}%", "description": "Review the remaining quota for the configured billing cycle.", "descriptionEn": "Review the remaining quota for the configured billing cycle.", "descriptionZh": "请检查当前自定义计费周期的剩余额度。", "time": "now", "timeEn": "now", "timeZh": "刚刚", "acknowledged": False, "source": "Traffic quota", "sourceEn": "Traffic quota", "sourceZh": "流量额度"})
            alerts[-1]["evidence"] = {"observedAt": system.get("observedAt"), "usedPercent": usage, "usedBytes": system["trafficUsedBytes"], "limitBytes": system["trafficLimitBytes"], "thresholdPercent": traffic_threshold, "comparison": "quota-percentage"}
        if system.get("alertCapacity", {}).get("requiresAttention") or system.get("diskPercent", 0) >= 90:
            alerts.append({"id": "storage-capacity", "severity": "warning", "title": "Storage capacity requires attention", "titleEn": "Storage capacity requires attention", "titleZh": "存储容量需要检查", "description": "Move verified private alert archives off this volume; active or unacknowledged episodes are protected.", "descriptionZh": "请将已验证的私有告警归档移至离线存储；活动或未确认记录受到保护，不会自动删除。", "source": "Storage", "acknowledged": False})
        for service in services:
            if service.get("id") == "certificate" and service.get("certificateState") in {"expired", "expiring", "unreadable"}:
                state = str(service["certificateState"])
                alerts.append({"id": f"certificate-{state}", "severity": "critical" if state == "expired" else "warning", "title": f"TLS certificate is {state}", "titleEn": f"TLS certificate is {state}", "titleZh": "TLS 证书已过期" if state == "expired" else "TLS 证书需要检查", "description": service["detail"], "descriptionEn": service["detail"], "descriptionZh": service.get("detailZh", service["detail"]), "time": "latest check", "timeEn": "latest check", "timeZh": "最近检查", "acknowledged": False, "source": "Certificate monitor", "sourceEn": "Certificate monitor", "sourceZh": "证书监控"})
                continue
            if service.get("id") == "certificate" and service.get("status") == "warning":
                alerts.append({"id": "certificate-evidence", "severity": "warning", "title": "TLS certificate evidence requires attention", "titleEn": "TLS certificate evidence requires attention", "titleZh": "TLS 证书证据需要检查", "description": f"Endpoint: {service.get('endpointEvidence', 'unknown')} · renewal: {service.get('renewalEvidence', 'unknown')}", "descriptionEn": f"Endpoint: {service.get('endpointEvidence', 'unknown')} · renewal: {service.get('renewalEvidence', 'unknown')}", "descriptionZh": f"站点证据：{service.get('endpointEvidence', 'unknown')} · 续期证据：{service.get('renewalEvidence', 'unknown')}", "time": "latest check", "timeEn": "latest check", "timeZh": "最近检查", "acknowledged": False, "source": "Certificate monitor", "sourceEn": "Certificate monitor", "sourceZh": "证书监控"})
                continue
            if service["status"] == "stopped":
                if service.get("stateReason") == "core_offline" and service["id"] in PROTOCOLS and any(item["id"] == "singbox" and item["status"] == "stopped" for item in services):
                    continue
                affected = [item for item in services if service["id"] == "singbox" and item["id"] in PROTOCOLS and item.get("stateReason") == "core_offline"]
                detail_en = service.get("detailEn", service["detail"])
                detail_zh = service.get("detailZh", service["detail"])
                if affected:
                    detail_en += " · Affected protocols: " + ", ".join(item.get("nameEn", item["name"]) for item in affected)
                    detail_zh += "；受影响协议：" + "、".join(item.get("nameZh", item["name"]) for item in affected)
                alerts.append({"id": f"service-{service['id']}", "severity": "critical", "title": f"{service['name']} is offline", "titleEn": f"{service.get('nameEn', service['name'])} is offline", "titleZh": f"{service.get('nameZh', service['name'])} 已离线", "description": detail_en, "descriptionEn": detail_en, "descriptionZh": detail_zh, "time": "now", "timeEn": "now", "timeZh": "刚刚", "acknowledged": False, "source": "Service monitor", "sourceEn": "Service monitor", "sourceZh": "服务监控", "affectedServices": [item["id"] for item in affected], "evidence": {"service": service.get("evidence", {}), "affectedProtocols": {item["id"]: item.get("evidence", {}) for item in affected}}})
            elif service["status"] == "warning" and service.get("id") not in {"certificate", "kernel"}:
                key = str(service.get("rootCauseId") or service["id"])
                reason = service.get("stateReason", "statistics_unavailable")
                # Keep the original outage episode while its recovery is unknown;
                # shared statistics failures must not create duplicate root events.
                if "service-" + service["id"] in unresolved_ids or key.startswith("singbox-") and "service-singbox" in unresolved_ids:
                    continue
                now = time.monotonic()
                first = self.unknown_since.setdefault(key, now)
                transitional = reason in {"inventory_missing", "inventory_stale", "core_generation_changed", "probe_unavailable"}
                if transitional and now - first < 30:
                    continue
                if any(item["id"] == "monitor-" + key for item in alerts):
                    continue
                title_en = f"{service['name']} monitoring evidence unavailable"
                title_zh = f"{service['name']} 状态证据无法确认"
                alerts.append({"id": "monitor-" + key, "severity": "warning", "title": title_en, "titleEn": title_en, "titleZh": title_zh, "description": service["detail"], "descriptionEn": service.get("detailEn", service["detail"]), "descriptionZh": service.get("detailZh", service["detail"]), "source": "Monitor evidence", "sourceEn": "Monitor evidence", "sourceZh": "监控证据", "time": "now", "acknowledged": False, "reason": reason, "evidence": service.get("evidence", {}), "affectedServices": [item["id"] for item in services if item.get("rootCauseId") == key]})
            else:
                self.unknown_since.pop(str(service.get("rootCauseId") or service["id"]), None)
        for target in network:
            latency = target.get("latency")
            loss = target.get("loss")
            evidence = {key: target.get(key) for key in ("batchId", "observedAt", "sampleStartedAt", "sampleEndedAt", "durationMs", "ipVersion", "resolvedIpVersion", "method", "status", "latency", "loss", "jitter", "sent", "received", "complete", "observedReplies", "probeReason", "alertConfirmed", "effectivePolicy", "qualityWindow", "layers")}
            if target.get("status") == "unavailable":
                alerts.append({"id": f"network-probe-{target['id']}", "severity": "warning", "title": f"{target['name']} probe is unavailable", "titleEn": f"{target['name']} probe is unavailable", "titleZh": f"{target['name']} 探测不可用", "description": f"Probe reason: {target.get('probeReason', 'unknown')}", "descriptionEn": f"Probe reason: {target.get('probeReason', 'unknown')}", "descriptionZh": f"探测原因：{target.get('probeReason', 'unknown')}", "time": "latest probe", "timeEn": "latest probe", "timeZh": "最近探测", "acknowledged": False, "source": "Network probe", "sourceEn": "Network probe", "sourceZh": "网络探测", "evidence": evidence})
            if target.get("alertConfirmed", target["status"] != "unavailable" and (target["status"] == "down" or (latency is not None and latency >= float(target.get("latencyMs", latency_threshold))) or (loss is not None and loss >= float(target.get("lossPercent", loss_threshold))))):
                alerts.append({"id": f"network-{target['id']}", "severity": "warning", "title": f"{target['name']} network quality degraded", "titleEn": f"{target['name']} network quality degraded", "titleZh": f"{target['name']} 网络质量下降", "description": f"Latency {target['latency']} ms · loss {target['loss']}%", "descriptionEn": f"Latency {target['latency']} ms · loss {target['loss']}%", "descriptionZh": f"延迟 {target['latency']} ms · 丢包 {target['loss']}%", "time": "latest probe", "timeEn": "latest probe", "timeZh": "最近探测", "acknowledged": False, "source": "Network probe", "sourceEn": "Network probe", "sourceZh": "网络探测", "evidence": evidence})
        # Losing listener evidence does not prove recovery of an existing fault.
        # Keep that episode open with an uncertainty warning until a fresh
        # service sample proves a running listener or a confirmed stop.
        present = {str(item["id"]) for item in alerts}
        for previous in previous_alerts:
            service = next((item for item in services if "service-" + item["id"] == previous["id"]), None)
            if service and previous["id"] not in present and service.get("status") == "warning" and service.get("stateReason") in {"inventory_missing", "inventory_stale", "inventory_invalid", "inventory_permission_denied", "core_generation_changed", "config_not_loaded", "probe_unavailable", "collector_stale", "statistics_unavailable", "core_state_unconfirmed", "configuration_unverified"}:
                retained = dict(previous)
                retained.update(severity="warning", title=f"{service['name']} recovery is unconfirmed", titleEn=f"{service['name']} recovery is unconfirmed", titleZh=f"{service['name']} 尚不能确认恢复", description=service["detail"], descriptionEn=service.get("detailEn", service["detail"]), descriptionZh=service.get("detailZh", service["detail"]), reason="recovery_unconfirmed", evidence=service.get("evidence", {}))
                alerts.append(retained)
        unknown_keys = {str(item.get("rootCauseId") or item["id"]) for item in services if item.get("status") == "warning"}
        self.unknown_since = {key: value for key, value in self.unknown_since.items() if key in unknown_keys}
        # A sampler that has not published a successful first round cannot
        # resolve a pre-existing network episode after backend restart.
        if not self.collection_state.get("network", {}).get("observedAt"):
            present = {item["id"] for item in alerts}
            alerts.extend(item for item in self.storage.active_alerts() if str(item["id"]).startswith("network-") and item["id"] not in present)
        for integration in integrations or []:
            if integration.get("configured") and integration.get("status") == "error":
                integration_id = str(integration.get("id", "unknown"))
                if any(item["id"] == integration_id and item.get("status") in {"stopped", "warning"} for item in services):
                    continue
                integration_names = {
                    "system": ("System metrics", "系统指标"), "hysteria2": ("Hysteria2", "Hysteria2"),
                    "anytls": ("AnyTLS", "AnyTLS"), "vless": ("VLESS", "VLESS"),
                    "socks5": ("SOCKS5", "SOCKS5"), "shadowsocks": ("Shadowsocks", "Shadowsocks"),
                    "vmess": ("VMess", "VMess"), "trojan": ("Trojan", "Trojan"), "tuic": ("TUIC", "TUIC"),
                    "connections": ("Connection activity", "连接活动"), "traffic": ("Traffic collection", "流量采集"),
                    "subscriptions": ("Subscriptions", "订阅配置"), "network": ("Network quality", "网络质量"),
                    "alerts": ("Alerts", "告警中心"), "audit": ("Audit log", "操作审计"),
                }
                name_en, name_zh = integration_names.get(integration_id, (integration_id, integration_id))
                summary_en = str(integration.get("summaryEn") or integration.get("summary") or "Runtime validation failed")
                summary_zh = str(integration.get("summaryZh") or "运行验证失败")
                alerts.append({"id": f"integration-{integration_id}", "severity": "warning", "title": f"{name_en} requires attention", "titleEn": f"{name_en} requires attention", "titleZh": f"{name_zh}需要检查", "description": summary_en, "descriptionEn": summary_en, "descriptionZh": summary_zh, "time": "now", "timeEn": "now", "timeZh": "刚刚", "acknowledged": False, "source": "Integration validation", "sourceEn": "Integration validation", "sourceZh": "数据接入验证"})
        for alert in alerts:
            if str(alert["id"]).startswith("network-"):
                matching = next((item for item in network if str(alert["id"]) in {"network-" + item["id"], "network-probe-" + item["id"]}), None)
                if matching:
                    alert["targetName"] = matching["name"]
                    alert["evidence"] = {key: matching.get(key) for key in ("batchId", "observedAt", "sampleStartedAt", "sampleEndedAt", "durationMs", "ipVersion", "resolvedIpVersion", "method", "status", "latency", "loss", "jitter", "sent", "received", "complete", "observedReplies", "probeReason", "alertConfirmed", "effectivePolicy", "qualityWindow", "layers")}
            elif str(alert["id"]) == "service-singbox":
                alert["affectedServices"] = [item["id"] for item in services if item["id"] in PROTOCOLS and item.get("stateReason") == "core_offline"]
        alerts.extend(self.collection_alerts())
        alerts = self.alert_policy.apply(alerts, previous_alerts)
        episodes = self.storage.reconcile_alerts(alerts)
        for alert in alerts:
            episode = episodes[str(alert["id"])]
            alert.update(episode)
        alerts = [with_alert_time(alert, alert["startedAt"]) for alert in alerts]
        return alerts

    def audit_page(self, page: int, page_size: int, search: str = "", category: str = "") -> dict[str, Any]:
        result = self.storage.audit_page(page, page_size, search, category)
        result["items"] = [
            {
                "id": f"audit-{row['id']}",
                "action": row["action"],
                "category": row["category"],
                "actor": row["actor"],
                "ip": row["source_ip"],
                "time": row["created_at"],
                "result": row["result"],
                "detail": row["detail"],
            }
            for row in result["items"]
        ]
        return result

    def public_subscriptions(self) -> list[dict[str, Any]]:
        public: list[dict[str, Any]] = []
        for source in self.config.subscriptions:
            item = {
                "id": str(source.get("id", ""))[:160],
                "account": str(source.get("account", "account"))[:160],
                "protocols": [str(value)[:80] for value in source.get("protocols", [])[:20]] if isinstance(source.get("protocols", []), list) else [],
                "enabled": bool(source.get("enabled", True)),
            }
            public.append(item)
        return public

    def runtime_integrations(self, hy2: dict[str, Any], singbox: dict[str, Any], network: list[dict[str, Any]], system: dict[str, Any] | None = None, subscription_probe: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        states = {item["id"]: item for item in self.config.public_integrations()}

        identity_mapping_lines: list[str] = []
        for account in self.config.managed_accounts:
            identities = account.get("trafficIdentities", {})
            if isinstance(identities, dict):
                identities = identities.get("hysteria2", [])
            if isinstance(identities, list) and identities:
                account_key = str(account.get("id") or account.get("name") or "")
                identity_mapping_lines.append(f"{account_key}={','.join(str(value) for value in identities)}")
        states["system"]["values"] = {"nodeName": self.config.node_name}
        states["hysteria2"]["values"] = {
            "endpoint": str(self.config.hysteria_api.get("url", "")),
            "identityMappings": "\n".join(identity_mapping_lines),
        }
        for integration_id in ("anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"):
            adapter = self.config.protocol_adapters.get(integration_id, {})
            values = {
                "endpoint": str(self.config.singbox_api.get("url", "")),
                "inboundTags": ",".join(str(value) for value in adapter.get("inboundTags", [])),
            }
            if integration_id == "vless":
                values["securityProfile"] = str(adapter.get("securityProfile", "standard"))
            states[integration_id]["values"] = values
        quota_state = self.traffic_quota_state()
        states["traffic"]["values"] = {
            "interface": self.config.interface,
            "countMode": str(quota_state["countMode"]),
        }
        states["network"]["values"] = {
            "targets": "\n".join(f"{item.get('name', item.get('address', ''))},{item.get('address', '')}" for item in self.config.network_targets),
        }
        states["alerts"]["values"] = {key: str(value) for key, value in self.config.alert_thresholds.items()}

        def update(integration_id: str, *, configured: bool | None = None, ready: bool, summary: str, summary_zh: str) -> None:
            state = states[integration_id]
            if configured is not None:
                state["configured"] = configured
            state["status"] = "ready" if ready else "error" if state["configured"] else "pending"
            state["summary"] = summary
            state["summaryEn"] = summary
            state["summaryZh"] = summary_zh
            state["observedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

        hy2_configured = bool(str(self.config.hysteria_api.get("url", "")).strip())
        sb_configured = bool(str(self.config.singbox_api.get("url", "")).strip())
        reported_identities = {str(value) for value in set(hy2.get("traffic", {})) | set(hy2.get("online", {}))}
        mapped_identities: set[str] = set()
        for account in self.config.managed_accounts:
            configured_identities = account.get("trafficIdentities", {})
            if isinstance(configured_identities, dict):
                configured_identities = configured_identities.get("hysteria2", [])
            if isinstance(configured_identities, list):
                mapped_identities.update(str(value) for value in configured_identities)
        unmapped_identities = reported_identities - mapped_identities
        hy2_api_ready = bool(hy2.get("available"))
        hy2_ready = bool(hy2_api_ready and (not self.config.managed_accounts or not unmapped_identities))
        if hy2_ready:
            hy2_summary = "Traffic Stats API is responding and reported identities are mapped"
            hy2_summary_zh = "Traffic Stats API 响应正常，已报告协议身份均有明确映射"
        elif hy2_api_ready and unmapped_identities:
            hy2_summary = f"Traffic Stats API is responding, but {len(unmapped_identities)} protocol identity mapping(s) are missing"
            hy2_summary_zh = f"Traffic Stats API 响应正常，但有 {len(unmapped_identities)} 个协议身份尚未映射到管理账号"
        else:
            hy2_summary = "Traffic Stats API is not configured or not responding"
            hy2_summary_zh = "Traffic Stats API 未配置或当前无响应"
        update("hysteria2", configured=hy2_configured, ready=hy2_ready, summary=hy2_summary, summary_zh=hy2_summary_zh)
        if protocol_requested(self.config, "hysteria2") and not hy2_ready:
            states["hysteria2"]["status"] = "error"
        for integration_id in PROTOCOLS:
            adapter = self.config.protocol_adapters.get(integration_id, {})
            configured = bool(sb_configured and adapter.get("inboundTags"))
            ready, summary, summary_zh = protocol_readiness(self.config, integration_id, singbox)
            update(integration_id, configured=configured, ready=ready, summary=summary, summary_zh=summary_zh)
            if protocol_requested(self.config, integration_id) and not ready:
                states[integration_id]["status"] = "error"
        self.connection_integration(states["connections"], hy2, singbox)
        system_ready = bool(system and system.get("kernel") and system.get("memoryTotalBytes"))
        storage_ready = bool(system_ready and system and system.get("databaseWritable"))
        update("system", ready=system_ready, summary="Host metrics are available" if system_ready else "Host metrics are unavailable", summary_zh="主机指标可用" if system_ready else "主机指标当前不可用")
        interface_fallback = bool(system and system.get("interfaceFallback"))
        traffic_ready = bool(storage_ready and not interface_fallback)
        if interface_fallback:
            sampled = str(system.get("interface", "unknown"))
            configured = str(system.get("configuredInterface", "unknown"))
            traffic_summary = f"Configured interface {configured} is unavailable; collecting real counters from detected interface {sampled}"
            traffic_summary_zh = f"配置网卡 {configured} 不可用；当前正从实际检测到的网卡 {sampled} 采集真实计数器"
        else:
            traffic_summary = "Traffic sampling and storage are writable" if storage_ready else "Traffic sampling storage is unavailable or read-only"
            traffic_summary_zh = "流量采样与存储可写" if storage_ready else "流量采样存储不可用或只读"
        update("traffic", ready=traffic_ready, summary=traffic_summary, summary_zh=traffic_summary_zh)
        subscription_state = subscription_probe or self.subscription_probe(self.config.subscription_base_url)
        subscription_count = int(subscription_state.get("count", 0))
        subscriptions_configured = bool(subscription_state.get("configured"))
        subscriptions_ready = bool(subscription_state.get("ready"))
        subscription_reachable = int(subscription_state.get("reachable", 0))
        subscription_parseable = int(subscription_state.get("parseable", 0))
        if subscriptions_configured:
            subscription_summary = f"Configured {subscription_count}; HTTPS reachable {subscription_reachable}/{subscription_count}; node format parseable {subscription_parseable}/{subscription_count}; client import unverified; proxy connectivity unverified"
            subscription_summary_zh = f"已配置 {subscription_count} 条；HTTPS 可达 {subscription_reachable}/{subscription_count}；节点格式可解析 {subscription_parseable}/{subscription_count}；客户端导入未验证；代理连通性未验证"
            if subscription_state.get("partial"):
                unchecked = subscription_state.get("unverifiedCount", 0)
                subscription_summary += f"; {unchecked} unchecked due to local budget or limit"
                subscription_summary_zh += f"；因本地预算或数量上限有 {unchecked} 条未检查，不能据此判定发布器故障"
        else:
            subscription_summary = "No protected subscription records are configured"
            subscription_summary_zh = "尚未配置受保护订阅记录"
        update("subscriptions", configured=subscriptions_configured, ready=subscriptions_ready, summary=subscription_summary, summary_zh=subscription_summary_zh)
        if subscription_state.get("partial"):
            states["subscriptions"]["status"] = "pending"
        network_ready = bool(network and any(item.get("status") in {"healthy", "degraded"} for item in network))
        update("network", configured=bool(self.config.network_targets), ready=network_ready, summary="At least one network target is reachable" if network_ready else "No configured network target is currently reachable", summary_zh="至少一个网络目标可达" if network_ready else "当前没有已配置的网络目标可达")
        update("alerts", ready=system_ready, summary="Alert evaluation is active" if system_ready else "Alert evaluation is unavailable without host metrics", summary_zh="告警计算正在运行" if system_ready else "缺少主机指标，告警计算不可用")
        update("audit", ready=storage_ready, summary="Audit storage is writable" if storage_ready else "Audit storage is unavailable or read-only", summary_zh="审计存储可写" if storage_ready else "审计存储不可用或只读")
        return list(states.values())

    def connection_integration(self, state: dict[str, Any], hy2: dict[str, Any], singbox: dict[str, Any], freshness: dict[str, Any] | None = None) -> None:
        sources = []
        for name, config, available in (
            ("hysteria2", self.config.hysteria_api, hy2.get("endpointStatus", {}).get("streams", hy2.get("available"))),
            ("singbox", self.config.singbox_api, singbox.get("available")),
        ):
            if str(config.get("url", "")).strip():
                fresh = freshness is None or freshness.get(name, {}).get("status") == "live"
                sources.append({"id": name, "status": "ready" if available and fresh else "error"})
        ready = sum(item["status"] == "ready" for item in sources)
        status = "pending" if not sources else "ready" if ready == len(sources) else "partial" if ready else "error"
        en = "No connection statistics adapter is configured" if not sources else f"Connection sources responding: {ready}/{len(sources)}"
        zh = "尚未配置连接统计适配器" if not sources else f"连接数据源正常：{ready}/{len(sources)}"
        state.update(configured=bool(sources), status=status, summary=en, summaryEn=en, summaryZh=zh, sources=sources)

    def subscription_url(self, subscription_id: str) -> str | None:
        for subscription in self.config.subscriptions:
            if str(subscription.get("id", "")) == subscription_id and subscription.get("enabled", True):
                value = str(subscription.get("url", "")).strip()
                return value or None
        return None

    def collect_system_snapshot(self) -> dict[str, Any]:
        """Sample only local host state and publish it atomically."""
        started = time.monotonic()
        with self.snapshot_lock:
            try:
                system = self.system_collector.snapshot()
            except Exception as error:
                self._collection_result("system", error=type(error).__name__)
                raise
        system["observedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.lock:
            self.system_cache = system
            self._collection_result("system", observed_at=system["observedAt"])
        pressure = self.resource_pressure.snapshot()
        if not self.storage.record_monitoring("resource", "backend", pressure):
            event("storage", "monitoring_write_failed")
        with self.lock:
            self.collection_state["system"]["durationMs"] = round((time.monotonic() - started) * 1000)
        return system

    def _collection_result(self, name: str, *, observed_at: str | None = None, error: str | None = None, duration_ms: float | None = None) -> None:
        with self.lock:
            previous = self.collection_state.get(name, {})
            self.collection_state[name] = {"observedAt": observed_at or previous.get("observedAt"), "error": error, "durationMs": duration_ms if duration_ms is not None else previous.get("durationMs")}

    def collection_freshness(self) -> dict[str, dict[str, Any]]:
        now = time.time()
        result = {}
        for name, ttl in (("system", 150), ("runtime", 90), ("hysteria2", 90), ("singbox", 90), ("network", 90), ("subscriptions", 180)):
            entry = dict(self.collection_state.get(name, {}))
            observed = entry.get("observedAt")
            if name == "system":
                observed = (self.system_cache or {}).get("observedAt", observed)
            elif name == "runtime":
                observed = self.runtime_cache.get("observedAt", observed)
            try:
                age = max(0, now - datetime.fromisoformat(str(observed).replace("Z", "+00:00")).timestamp())
            except (ValueError, TypeError):
                age = None
            status = "initializing" if age is None and not entry.get("error") and time.monotonic() - self.started_monotonic < 30 else "unavailable" if age is None else "stale" if age > ttl else "error" if entry.get("error") else "live"
            result[name] = {"status": status, "observedAt": observed, "ageSeconds": round(age, 1) if age is not None else None, "ttlSeconds": ttl, "error": entry.get("error"), "durationMs": entry.get("durationMs")}
        return result

    def collection_alerts(self) -> list[dict[str, Any]]:
        result = []
        labels = {"system": ("Host metrics", "主机指标"), "runtime": ("Runtime monitor", "运行状态监控"), "network": ("Network probes", "网络探测")}
        for name, (en, zh) in labels.items():
            item = self.collection_freshness()[name]
            if item["status"] in {"live", "initializing"}:
                continue
            description = f"Status: {item['status']}; last measurement: {item['observedAt'] or 'unavailable'}"
            result.append({"id": f"collector-{name}", "severity": "warning", "title": f"{en} collection requires attention", "titleEn": f"{en} collection requires attention", "titleZh": f"{zh}采集需要检查", "description": description, "descriptionEn": description, "descriptionZh": f"采集状态：{item['status']}；最近测量：{item['observedAt'] or '暂无'}", "source": "Collector monitor", "sourceEn": "Collector monitor", "sourceZh": "采集监控", "time": "latest check", "acknowledged": False, "evidence": {"domain": name, **item}})
        return result

    def refresh_collection_alerts(self) -> None:
        """A blocked sampler cannot keep its status healthy."""
        with self.lock:
            active = [item for item in self.storage.active_alerts() if not str(item["id"]).startswith("collector-")]
            active.extend(self.collection_alerts())
            active = self.alert_policy.apply(active, self.storage.active_alerts(), prune=False)
            self.storage.reconcile_alerts(active)
            self.runtime_cache["alerts"] = self.storage.alert_history()

    def evaluate_monitoring(self, system: dict[str, Any], services: list[dict[str, Any]], network: list[dict[str, Any]], integrations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        active = self.alerts(system, services, network, integrations)
        history = self.storage.alert_history()
        by_episode = {str(item.get("episodeId")): item for item in history}
        for item in active:
            by_episode[str(item.get("episodeId"))] = {**item, "status": "active", "resolvedAt": None}
        return list(by_episode.values())



    def refresh_adapter(self, name: str) -> None:
        started = time.monotonic()
        function = hysteria_snapshot if name == "hysteria2" else singbox_snapshot
        result = function(self.config)
        with self.lock:
            self.runtime_cache["hy2" if name == "hysteria2" else "singbox"] = result
            self._collection_result(name, observed_at=result.get("observedAt") or timestamp(), error="adapter_unavailable" if not result.get("available") else None)
        if name == "singbox":
            inventory = result.get("inventory", {})
            self.storage.record_monitoring("protocol", "singbox", {key: inventory.get(key) for key in ("available", "reason", "pid", "corePid", "bootId", "startedTicks", "sampledAt", "sampleStartedAt", "sampleEndedAt", "ageSeconds", "inbounds")})
        with self.lock:
            self.collection_state.setdefault(name, {})["durationMs"] = round((time.monotonic() - started) * 1000)

    @staticmethod
    def _layer_signature(target: dict[str, Any]) -> tuple:
        return tuple(target.get(key) for key in ("address", "ipVersion", "tcpPort", "dnsPort", "dnsName"))

    def refresh_network_layers(self) -> None:
        with self.lock:
            generation = self.network_generation
            targets = copy.deepcopy(self.config.network_targets)
        pending = [item for item in targets if item.get("tcpPort") or item.get("dnsPort") or item.get("dnsName")]
        if not pending:
            with self.lock:
                if generation == self.network_generation:
                    self.layer_cache.clear()
            return
        with ThreadPoolExecutor(max_workers=min(12, len(pending)), thread_name_prefix="optional-probe") as pool:
            results = list(pool.map(layered_probe, pending))
        with self.lock:
            if generation != self.network_generation:
                return
            self.layer_cache = {item["id"]: (time.monotonic(), {"signature": self._layer_signature(item), "layers": layers}) for item, layers in zip(pending, results)}

    def refresh_network(self) -> None:
        started = time.monotonic()
        with self.lock:
            candidate = copy.copy(self.config)
            candidate.network_targets = copy.deepcopy(self.config.network_targets)
            generation = self.network_generation
        samples = network_snapshots(candidate, count=1)
        with self.lock:
            if generation != self.network_generation:
                return
            self.network_series.retain({item["id"] for item in samples})
            for item in samples:
                self.network_series.append(item)
                cached = self.layer_cache.get(item["id"])
                item["layers"] = copy.deepcopy(cached[1]["layers"]) if cached and cached[1].get("signature") == self._layer_signature(item) else {}
            # The global alert policy and durable history retain their 20s cadence.
            # Live ICMP points never write one database row per second.
            if not self.network_recorded_monotonic or time.monotonic() - self.network_recorded_monotonic >= 20:
                archives = [self.network_series.aggregate(item, self.network_recorded_at) for item in samples]
                self.network_policy.apply(archives, candidate.alert_thresholds)
                for item in archives:
                    payload = {key: item.get(key) for key in ("observedAt", "ipVersion", "resolvedIpVersion", "status", "latency", "loss", "jitter", "sent", "received", "complete", "hasGaps", "sampleIntervalSeconds")}
                    if not self.storage.record_monitoring("network", item["id"], payload):
                        event("storage", "monitoring_write_failed")
                    family = item.get("resolvedIpVersion") or item.get("ipVersion", 0)
                    self.network_time_cache[(item["id"], family)] = self.storage.network_time_history(item["id"], 1, family)["samples"]
                self.network_recorded_at = time.time()
                self.network_recorded_monotonic = time.monotonic()
            for item in samples:
                family = item.get("resolvedIpVersion") or item.get("ipVersion", 0)
                item["timeHistory"] = self.network_time_cache.get((item["id"], family), [])
                item["alertConfirmed"] = bool(self.network_policy.states.get(item["id"], {}).get("confirmed"))
            self.runtime_cache["network"] = samples
            self._collection_result("network", observed_at=timestamp())
            self.collection_state["network"]["durationMs"] = round((time.monotonic() - started) * 1000)

    def network_targets_snapshot(self) -> list[dict[str, Any]]:
        with self.lock:
            result = copy.deepcopy(self.runtime_cache.get("network", []))
            freshness = self.collection_freshness()["network"]
        stale = freshness["ageSeconds"] is None or freshness["ageSeconds"] > 5
        for item in result:
            for key in ("latencyMs", "lossPercent", "thresholdOverrides", "effectivePolicy", "qualityWindow", "alertConfirmed"):
                item.pop(key, None)
            if stale:
                item.update(status="unavailable", measurementStatus="unavailable", probeReason="pending" if freshness.get("error") == "pending" else "stale", latency=None, loss=None, jitter=None, history=[], probeHistory=[])
        return result

    def refresh_subscription(self) -> None:
        started = time.monotonic()
        result = self.subscription_probe(force=False)
        with self.lock:
            self.runtime_cache["subscription"] = result
            self._collection_result("subscriptions", observed_at=timestamp(), duration_ms=round((time.monotonic() - started) * 1000))

    def refresh_services(self) -> None:
        started = time.monotonic()
        with self.lock:
            if self.system_cache is None:
                return
            system = copy.deepcopy(self.system_cache)
            runtime = copy.deepcopy(self.runtime_cache)
            freshness = self.collection_freshness()
        for name, key in (("hysteria2", "hy2"), ("singbox", "singbox")):
            if freshness[name]["status"] in {"stale", "unavailable"}:
                runtime[key]["available"] = False
                if key == "singbox":
                    runtime[key]["inventory"] = {"available": False, "reason": "collector_stale"}
        services = service_snapshots(self.config, system, runtime["hy2"], runtime["singbox"])
        maintenance = maintenance_info()
        if maintenance.get("id"):
            for item in services:
                item.setdefault("evidence", {})["maintenance"] = maintenance
        if maintenance.get("expired") or maintenance.get("state") in {"activation_failed", "preparation_failed", "rolled_back"}:
            services.append({"id": "certificate-maintenance", "name": "Certificate delivery", "nameEn": "Certificate delivery", "nameZh": "证书交付", "icon": "published_with_changes", "kind": "monitor", "status": "warning", "version": "", "detail": "Certificate maintenance expired or rolled back; inspect activation evidence", "detailZh": "证书维护超时或已回退，请检查生效证据", "stateReason": "certificate_maintenance_failed", "evidence": {"maintenance": maintenance}})
        integrations = self.runtime_integrations(runtime["hy2"], runtime["singbox"], runtime["network"], system, runtime["subscription"])
        observed = timestamp()
        with self.lock:
            self.runtime_cache.update(services=services, integrations=integrations, observedAt=observed, maintenance=maintenance)
            self._collection_result("runtime", observed_at=observed)
            self.runtime_cache["alerts"] = self.evaluate_monitoring(system, services, runtime["network"], integrations)
            generation = tuple(runtime["singbox"].get("inventory", {}).get(key) for key in ("bootId", "pid", "startedTicks"))
            if self.connection_generation != generation:
                self.connection_baseline = {}
                self.connection_generation = generation
            self.runtime_cache["connections"] = self.with_online_clients(self.aggregate_connections(connection_snapshots(runtime["hy2"], runtime["singbox"], self.config.protocol_adapters)), runtime["hy2"])
        lifecycle = [{"id": item["id"], "status": item["status"], "reason": item.get("stateReason"),
                      "generation": {key: item.get("evidence", {}).get(key) for key in ("bootId", "pid", "startedTicks")}} for item in services if item.get("kind") in {"core", "protocol"}]
        if lifecycle != self.last_core_evidence:
            self.storage.record_monitoring("lifecycle", "cores", {"observedAt": observed, "services": lifecycle})
            self.last_core_evidence = lifecycle
        try:
            import json
            path = Path("/run/castoriceui/core-events.json")
            if path.stat().st_size <= 65536:
                events = json.loads(path.read_text())
                seen = self.storage.get_setting("core_event_ids", [])
                for item in events:
                    event_id = str(item.get("InvocationID", ""))
                    if event_id and event_id not in seen:
                        self.storage.record_monitoring("lifecycle", str(item.get("unit", "core")), item)
                        seen.append(event_id)
                if seen:
                    self.storage.set_setting("core_event_ids", seen[-128:])
        except (OSError, ValueError, TypeError):
            pass
        with self.lock:
            self.collection_state["runtime"]["durationMs"] = round((time.monotonic() - started) * 1000)

    def snapshot(self) -> dict[str, Any]:
        return self._snapshot()

    def _snapshot(self) -> dict[str, Any]:
        with self.lock:
            system = copy.deepcopy(self.system_cache)
            runtime = copy.deepcopy(self.runtime_cache)
            current_rules = {key: str(value) for key, value in self.config.alert_thresholds.items()}
            current_alert_configuration = {key: self.config.integrations.get("alerts", {}).get(key, True) for key in ("enabled", "configured")}
        if system is None:
            system = self.collect_system_snapshot()
        # Settings are current configuration, independent of the cached measurement interval.
        system["nodeName"] = self.config.node_name
        hy2 = runtime["hy2"]
        singbox = runtime["singbox"]
        network = runtime["network"]
        services = runtime["services"]
        integrations = runtime["integrations"] or self.config.public_integrations()
        connections = runtime.get("connections", [])
        freshness = self.collection_freshness()
        stale = any(freshness[key]["status"] != "live" for key in ("system", "runtime"))
        if freshness["network"]["status"] != "live":
            network = [{**target, "status": "unavailable", "measurementStatus": "unavailable", "probeReason": "stale" if freshness["network"]["status"] == "stale" else "pending" if freshness["network"].get("error") == "pending" else "probeFailed", "latency": None, "jitter": None, "loss": None, "history": []} for target in network]
        for integration in integrations:
            if integration["id"] == "alerts":
                integration.update(current_alert_configuration)
                integration["values"] = current_rules
            if integration["id"] == "connections":
                self.connection_integration(integration, hy2, singbox, freshness)
                continue
            collector = "hysteria2" if integration["id"] == "hysteria2" else "singbox" if integration["id"] in {"anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"} else integration["id"]
            if collector in freshness and freshness[collector]["status"] != "live" and integration.get("configured"):
                integration["status"] = "error"
                integration["summaryEn"] = "Cached evidence; collection requires attention"
                integration["summaryZh"] = "缓存证据：采集需要检查"
        if stale:
            for service in services:
                service["status"] = "warning"
                service["detailEn"] = "Cached evidence; collection is stale or unavailable"
                service["detailZh"] = "缓存证据：采集已过期或不可用"
            for integration in integrations:
                integration["ready"] = False
                integration["status"] = "error"
        for connection in connections:
            source = "hysteria2" if connection["protocol"] == "Hysteria2" else "singbox"
            core = hy2 if source == "hysteria2" else singbox
            if stale or freshness[source]["status"] != "live" or not core.get("available"):
                connection["downloadBps"] = connection["uploadBps"] = None
                connection.pop("onlineClients", None)
                for detail in connection.get("details", []):
                    detail["downloadBps"] = detail["uploadBps"] = None
            # Destinations require a deliberate live-view request even when an
            # older deployment disabled the global redaction setting.
            for detail in connection.get("details", []):
                detail["destination"] = None
        traffic = self.traffic_series()
        with self.lock:
            sample_at = self.system_collector.last_persisted_at
            if self.resource_history_cache is None or self.resource_history_cache[0] != sample_at:
                self.resource_history_cache = (sample_at, self.storage.resource_history(int(time.time())))
            resource_history = self.resource_history_cache[1]
        authoritative_total = int(system["trafficUsedBytes"])
        accounts = self.account_metrics(copy.deepcopy(self.config.managed_accounts), hy2, authoritative_total)
        singbox_label = "AnyTLS" if self.config.integrations.get("anytls", {}).get("configured") and not self.config.protocol_adapters else "sing-box combined"
        raw_protocol = [
            {"name": "Hysteria2", "value": sum(int(v.get("tx", 0)) + int(v.get("rx", 0)) for v in hy2.get("traffic", {}).values())},
            {"name": singbox_label, "nameZh": "sing-box 合计" if singbox_label == "sing-box combined" else singbox_label, "nameEn": singbox_label, "value": int(singbox.get("traffic", {}).get("up", 0)) + int(singbox.get("traffic", {}).get("down", 0))},
        ]
        protocol = self.reconcile_breakdown(raw_protocol, authoritative_total, "Unattributed")
        for item in protocol:
            if item.get("name") == "Unattributed":
                item.update({"nameZh": "未归属", "nameEn": "Unattributed"})
        account_breakdown = [{"name": item.get("name", "account"), "value": item.get("usedBytes", 0)} for item in accounts]
        attributed_accounts = sum(int(item["value"]) for item in account_breakdown)
        if authoritative_total > attributed_accounts:
            account_breakdown.append({"name": "Unattributed", "nameZh": "未归属", "nameEn": "Unattributed", "value": authoritative_total - attributed_accounts})
        saved_ui_settings = self.storage.get_setting("ui_settings", {})
        if not isinstance(saved_ui_settings, dict):
            saved_ui_settings = {}
        else:
            saved_ui_settings = dict(saved_ui_settings)
        saved_ui_settings["visiblePanels"] = ordered_visible_panels(saved_ui_settings.get("visiblePanels"))
        if saved_ui_settings.get("idleTimeoutMinutes", 15) not in {2, 5, 10, 15, 20, 30}:
            saved_ui_settings["idleTimeoutMinutes"] = 15
        return {
            "mode": "stale" if stale else "live",
            "freshness": freshness,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "overview": system,
            "resourceHistory": resource_history,
            "accounts": accounts,
            "connections": connections,
            "traffic": {
                **traffic,
                "monthly": self.monthly_traffic_usage(),
                "totalBytes": authoritative_total,
                "protocolTotalBytes": sum(int(item["value"]) for item in protocol),
                "accountTotalBytes": sum(int(item["value"]) for item in account_breakdown),
                "protocol": protocol,
                "account": account_breakdown,
                "coverage": system.get("trafficCoverage"),
            },
            "subscriptions": self.public_subscriptions(),
            "networkTargets": self.network_targets_snapshot(),
            "services": services,
            "alerts": runtime["alerts"],
            "alertSummary": self.storage.alert_summary(),
            "integrations": integrations,
            "runtimeObservedAt": runtime["observedAt"],
            "uiSettings": {
                "showSetup": True,
                "visiblePanels": list(VISIBLE_PANEL_ORDER),
                "panelTitle": "CastoriceUI",
                "idleTimeoutMinutes": 15,
                **saved_ui_settings,
            },
        }
