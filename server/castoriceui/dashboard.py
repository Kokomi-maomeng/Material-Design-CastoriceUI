from __future__ import annotations

import threading
import time
import copy
import ipaddress
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from .collectors import (
    SystemCollector,
    connection_snapshots,
    http_json,
    hysteria_snapshot,
    network_snapshots,
    service_snapshots,
    singbox_snapshot,
)
from .config import AppConfig
from .security import normalize_https_base_url, normalize_loopback_endpoint, validate_interface_name, validate_probe_target
from .storage import Storage


class DashboardService:
    def __init__(self, config: AppConfig, storage: Storage) -> None:
        self.config = config
        self.storage = storage
        self.system_collector = SystemCollector(config, storage)
        self.lock = threading.RLock()
        self.snapshot_lock = threading.Lock()
        self.cached_network: list[dict[str, Any]] = []
        self.network_at = 0.0
        overrides = storage.get_setting("integration_overrides", {})
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
                    if integration_id in {"hysteria2", "anytls"} and isinstance(values, dict) and values.get("endpoint"):
                        try:
                            values["endpoint"] = normalize_loopback_endpoint(str(values["endpoint"]))
                        except ValueError:
                            values = dict(values)
                            values.pop("endpoint", None)
                            value = {**value, "values": values, "configured": False, "status": "pending"}
                            overrides[integration_id] = value
                            sanitized_legacy_secrets = True
                    config.integrations[integration_id].update(value)
                    if isinstance(values, dict):
                        self._apply_integration_values(integration_id, {key: str(item) for key, item in values.items()})
        if sanitized_legacy_secrets:
            storage.set_setting("integration_overrides", overrides)
            storage.add_audit("清理旧版接入密钥", "配置", "已从 SQLite 覆盖项中移除 v1.2 遗留的明文 Secret")

    def _apply_integration_values(self, integration_id: str, values: dict[str, str]) -> None:
        if integration_id == "hysteria2":
            self.config.hysteria_api.update({"url": values.get("endpoint", "")})
        elif integration_id == "anytls":
            self.config.singbox_api.update({"url": values.get("endpoint", "")})
        elif integration_id == "traffic":
            interface = values.get("interface", "").strip()
            if interface:
                interface = validate_interface_name(interface)
                self.config.interface = interface
                self.system_collector.interface = interface
            quota = values.get("quotaGb", "").strip()
            if quota:
                quota_bytes = round(float(quota) * 1024 ** 3)
                if quota_bytes < 1_000_000_000:
                    raise ValueError("Traffic quota must be at least 1 GB")
                self.storage.set_setting("traffic_limit_bytes", quota_bytes)
        elif integration_id == "subscriptions":
            self.config.subscription_base_url = values.get("baseUrl", "").strip()
        elif integration_id == "network" and values.get("targets", "").strip():
            targets: list[dict[str, Any]] = []
            for index, line in enumerate(values["targets"].splitlines()[:12]):
                address = line.strip()
                if not address:
                    continue
                address, version = validate_probe_target(address)
                targets.append({"id": f"custom-{index + 1}", "name": address, "provider": "Custom", "address": address, "ipVersion": version})
            if not targets:
                raise ValueError("At least one valid network target is required")
            self.config.network_targets = targets
            self.cached_network = []
            self.network_at = 0.0
        elif integration_id == "alerts":
            for key in ("trafficPercent", "latencyMs", "lossPercent"):
                raw = values.get(key, "").strip()
                if raw:
                    value = float(raw)
                    if value < 0:
                        raise ValueError("Alert thresholds cannot be negative")
                    self.config.alert_thresholds[key] = value

    def configure_integration(self, integration_id: str, payload: dict[str, Any], source_ip: str = "127.0.0.1") -> dict[str, Any]:
        allowed_fields = {
            "hysteria2": {"endpoint"},
            "anytls": {"endpoint"},
            "traffic": {"interface", "quotaGb"},
            "connections": set(),
            "subscriptions": {"baseUrl"},
            "network": {"targets"},
            "alerts": {"trafficPercent", "latencyMs", "lossPercent"},
            "audit": set(),
            "system": set(),
        }
        if integration_id not in allowed_fields:
            raise ValueError("Unknown integration")
        values = payload.get("values", {})
        if not isinstance(values, dict):
            raise ValueError("Integration values must be an object")
        clean_values = {key: str(value)[:2048] for key, value in values.items() if key in allowed_fields[integration_id]}
        enabled = bool(payload.get("enabled", True))
        required = {"hysteria2": {"endpoint"}, "anytls": {"endpoint"}, "subscriptions": {"baseUrl"}}
        configured = required.get(integration_id, set()).issubset({key for key, value in clean_values.items() if value.strip()})
        if integration_id not in required:
            configured = True
        if not configured:
            raise ValueError("Complete the required fields")
        self._validate_integration(integration_id, clean_values)
        summaries = {
            "hysteria2": "Endpoint saved; connectivity and authentication validated",
            "anytls": "Endpoint saved; connectivity and authentication validated",
            "subscriptions": "HTTPS URL format validated; publisher reachability is not probed",
            "network": "Probe targets saved; runtime reachability is reported separately",
            "traffic": "Traffic sampling settings saved",
            "connections": "Connection view enabled; fields depend on configured protocol adapters",
            "alerts": "Alert thresholds saved",
            "audit": "Local audit recording enabled",
            "system": "Local system collection enabled",
        }
        summary = summaries.get(integration_id, "Configuration saved") if configured else "Complete the required fields"
        state = {"enabled": enabled, "configured": configured, "status": "ready" if configured else "pending", "summary": summary, "values": clean_values}
        self._apply_integration_values(integration_id, clean_values)
        overrides = self.storage.get_setting("integration_overrides", {})
        overrides[integration_id] = state
        self.storage.set_setting("integration_overrides", overrides)
        self.config.integrations[integration_id].update(state)
        self.storage.add_audit("更新数据接入", "配置", f"{integration_id} 接入配置已更新", source_ip)
        return next(item for item in self.config.public_integrations() if item["id"] == integration_id)

    def _validate_integration(self, integration_id: str, values: dict[str, str]) -> None:
        if integration_id == "hysteria2":
            endpoint = normalize_loopback_endpoint(values["endpoint"])
            secret = str(self.config.hysteria_api.get("secret", "")).strip()
            if not secret or secret == "replace-on-server":
                raise ValueError("Configure the Hysteria2 Secret in the protected server config first")
            http_json(endpoint + "/traffic", secret, strict=True)
            values["endpoint"] = endpoint
        elif integration_id == "anytls":
            endpoint = normalize_loopback_endpoint(values["endpoint"])
            secret = str(self.config.singbox_api.get("secret", "")).strip()
            if not secret or secret == "replace-on-server":
                raise ValueError("Configure the sing-box Secret in the protected server config first")
            http_json(endpoint + "/connections", secret, bearer=True, strict=True)
            values["endpoint"] = endpoint
        elif integration_id == "subscriptions":
            values["baseUrl"] = normalize_https_base_url(values["baseUrl"])
        elif integration_id == "network" and values.get("targets", "").strip():
            for line in values["targets"].splitlines()[:12]:
                if line.strip():
                    validate_probe_target(line)
        elif integration_id == "traffic":
            if values.get("interface", "").strip():
                values["interface"] = validate_interface_name(values["interface"])
            if values.get("quotaGb", "").strip():
                quota = float(values["quotaGb"])
                if not 0 < quota <= 1_000_000:
                    raise ValueError("quotaGb must be between 0 and 1000000")
        elif integration_id == "alerts":
            limits = {"trafficPercent": (0, 100), "lossPercent": (0, 100), "latencyMs": (0, 60_000)}
            for key, (minimum, maximum) in limits.items():
                if values.get(key, "").strip():
                    number = float(values[key])
                    if not minimum <= number <= maximum:
                        raise ValueError(f"{key} must be between {minimum} and {maximum}")

    def network(self) -> list[dict[str, Any]]:
        with self.lock:
            if time.monotonic() - self.network_at > 300 or not self.cached_network:
                self.cached_network = network_snapshots(self.config)
                self.network_at = time.monotonic()
            return self.cached_network

    def traffic_series(self) -> dict[str, Any]:
        now = int(time.time())
        samples = self.storage.samples_since(now - 30 * 86400)
        hourly: dict[str, list[dict[str, Any]]] = defaultdict(list)
        daily: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for sample in samples:
            moment = datetime.fromtimestamp(sample["captured_at"], timezone.utc)
            hourly[moment.strftime("%H:00")].append(sample)
            daily[moment.strftime("%m/%d")].append(sample)

        def deltas(groups: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
            result = []
            for label, values in groups.items():
                first, last = values[0], values[-1]
                result.append({"label": label, "upload": max(0, last["tx_bytes"] - first["tx_bytes"]), "download": max(0, last["rx_bytes"] - first["rx_bytes"])})
            return result

        return {"hourly": deltas(hourly), "daily": deltas(daily)}

    def alerts(self, system: dict[str, Any], services: list[dict[str, Any]], network: list[dict[str, Any]]) -> list[dict[str, Any]]:
        alerts: list[dict[str, Any]] = []
        usage = 100 * system["trafficUsedBytes"] / max(1, system["trafficLimitBytes"])
        traffic_threshold = float(self.config.alert_thresholds.get("trafficPercent", 80))
        latency_threshold = float(self.config.alert_thresholds.get("latencyMs", 150))
        loss_threshold = float(self.config.alert_thresholds.get("lossPercent", 5))
        if usage >= traffic_threshold:
            alerts.append({"id": "traffic-threshold", "severity": "critical" if usage >= max(95, traffic_threshold + 10) else "warning", "title": f"Traffic usage reached {usage:.0f}%", "description": "Review the remaining monthly quota and recent growth trend.", "time": "now", "acknowledged": False, "source": "Traffic quota"})
        for service in services:
            if service["status"] == "stopped":
                alerts.append({"id": f"service-{service['id']}", "severity": "critical", "title": f"{service['name']} is offline", "description": service["detail"], "time": "now", "acknowledged": False, "source": "Service monitor"})
        for target in network:
            if target["status"] == "down" or target["latency"] >= latency_threshold or target["loss"] >= loss_threshold:
                alerts.append({"id": f"network-{target['id']}", "severity": "warning", "title": f"{target['name']} network quality degraded", "description": f"Latency {target['latency']} ms · loss {target['loss']}%", "time": "latest probe", "acknowledged": False, "source": "Network probe"})
        acknowledged = self.storage.acknowledged()
        for alert in alerts:
            alert["acknowledged"] = alert["id"] in acknowledged
        return alerts

    def audit_events(self) -> list[dict[str, Any]]:
        return [{"id": f"audit-{row['id']}", "action": row["action"], "category": row["category"], "actor": self._mask_identity(row["actor"]) if self.config.redact_live_data else row["actor"], "ip": self._mask_ip(row["source_ip"]) if self.config.redact_live_data else row["source_ip"], "time": row["created_at"], "result": row["result"], "detail": row["detail"]} for row in self.storage.audits()]

    @staticmethod
    def _mask_identity(value: Any) -> str:
        text = str(value or "unknown")
        if "@" in text:
            local, domain = text.split("@", 1)
            return f"{local[:1]}***@{domain}"
        if len(text) <= 2:
            return text[:1] + "*"
        return text[:1] + "*" * min(6, len(text) - 2) + text[-1:]

    @staticmethod
    def _mask_ip(value: Any) -> str:
        text = str(value or "unknown")
        try:
            address = ipaddress.ip_address(text)
        except ValueError:
            return text if text in {"unknown", "provided by protocol core"} else "masked"
        if address.version == 4:
            parts = text.split(".")
            return ".".join((*parts[:3], "*"))
        groups = address.exploded.split(":")
        return ":".join((*groups[:2], "****", "****", "****", "****", "****", "****"))

    def public_subscriptions(self) -> list[dict[str, Any]]:
        public: list[dict[str, Any]] = []
        for source in self.config.subscriptions:
            item = {key: copy.deepcopy(value) for key, value in source.items() if key != "url"}
            if self.config.redact_live_data:
                item["account"] = self._mask_identity(item.get("account", "account"))
            public.append(item)
        return public

    def runtime_integrations(self, hy2: dict[str, Any], singbox: dict[str, Any], network: list[dict[str, Any]]) -> list[dict[str, Any]]:
        states = {item["id"]: item for item in self.config.public_integrations()}

        def update(integration_id: str, *, configured: bool | None = None, ready: bool, summary: str) -> None:
            state = states[integration_id]
            if configured is not None:
                state["configured"] = configured
            state["status"] = "ready" if ready else "error" if state["configured"] else "pending"
            state["summary"] = summary

        hy2_configured = bool(str(self.config.hysteria_api.get("url", "")).strip())
        sb_configured = bool(str(self.config.singbox_api.get("url", "")).strip())
        update("hysteria2", configured=hy2_configured, ready=bool(hy2.get("available")), summary="Traffic Stats API is responding" if hy2.get("available") else "Traffic Stats API is not configured or not responding")
        update("anytls", configured=sb_configured, ready=bool(singbox.get("available")), summary="sing-box connections API is responding" if singbox.get("available") else "sing-box connections API is not configured or not responding")
        hy2_streams_ready = bool(hy2.get("endpointStatus", {}).get("streams", hy2.get("available")))
        adapters_ready = bool(hy2_streams_ready or singbox.get("available"))
        update("connections", ready=adapters_ready, summary="Protocol connection snapshots are available; individual fields may be absent" if adapters_ready else "No configured protocol statistics adapter is currently responding")
        update("system", ready=True, summary="Local /proc, filesystem and systemd data collected")
        update("traffic", ready=True, summary=f"Interface {self.system_collector.interface} counters sampled; monthly usage starts at the first retained sample")
        subscription_count = len(self.config.subscriptions)
        update("subscriptions", configured=subscription_count > 0 or bool(self.config.subscription_base_url), ready=subscription_count > 0, summary=f"{subscription_count} protected configuration record(s) loaded; publisher reachability is not verified")
        reachable = sum(1 for target in network if target.get("status") != "down")
        update("network", configured=bool(self.config.network_targets), ready=bool(network), summary=f"Last cached probe: {reachable}/{len(network)} targets reachable; results may be up to 5 minutes old" if network else "No network probe result is available")
        update("alerts", ready=True, summary="Local threshold evaluation enabled")
        update("audit", ready=True, summary="Local audit records loaded from protected storage")
        return list(states.values())

    def subscription_url(self, subscription_id: str) -> str | None:
        for subscription in self.config.subscriptions:
            if str(subscription.get("id", "")) == subscription_id and subscription.get("enabled", True):
                value = str(subscription.get("url", "")).strip()
                return value or None
        return None

    def snapshot(self) -> dict[str, Any]:
        # SystemCollector keeps previous counter samples, so concurrent requests
        # must not race while updating those baselines.
        with self.snapshot_lock:
            return self._snapshot()

    def _snapshot(self) -> dict[str, Any]:
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="dashboard") as pool:
            system_future = pool.submit(self.system_collector.snapshot)
            hysteria_future = pool.submit(hysteria_snapshot, self.config)
            singbox_future = pool.submit(singbox_snapshot, self.config)
            network_future = pool.submit(self.network)
            system = system_future.result()
            hy2 = hysteria_future.result()
            singbox = singbox_future.result()
            network = network_future.result()
        services = service_snapshots(self.config, system, hy2, singbox)
        connections = connection_snapshots(hy2, singbox)
        integrations = self.runtime_integrations(hy2, singbox, network)
        if self.config.redact_live_data:
            for connection in connections:
                connection["sourceIp"] = self._mask_ip(connection.get("sourceIp"))
                connection["account"] = self._mask_identity(connection.get("account"))
        traffic = self.traffic_series()
        accounts = copy.deepcopy(self.config.managed_accounts)
        for account in accounts:
            identity = account.get("name", "")
            hy2_usage = hy2.get("traffic", {}).get(identity, {})
            account["usedBytes"] = int(hy2_usage.get("tx", 0)) + int(hy2_usage.get("rx", 0))
            account["onlineDevices"] = int(hy2.get("online", {}).get(identity, 0))
            if self.config.redact_live_data:
                account["name"] = self._mask_identity(identity)
                account["email"] = self._mask_identity(account.get("email", ""))
                if account.get("note"):
                    account["note"] = "已设置备注（内容已隐藏）"
        protocol = [
            {"name": "Hysteria2", "value": sum(int(v.get("tx", 0)) + int(v.get("rx", 0)) for v in hy2.get("traffic", {}).values())},
            {"name": "AnyTLS", "value": int(singbox.get("traffic", {}).get("up", 0)) + int(singbox.get("traffic", {}).get("down", 0))},
        ]
        return {
            "mode": "live",
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "overview": system,
            "accounts": accounts,
            "connections": connections,
            "traffic": {**traffic, "protocol": protocol, "account": [{"name": item.get("name", "account"), "value": item.get("usedBytes", 0)} for item in accounts]},
            "subscriptions": self.public_subscriptions(),
            "networkTargets": network,
            "services": services,
            "alerts": self.alerts(system, services, network),
            "auditEvents": self.audit_events(),
            "integrations": integrations,
            "resourceHistory": [{"label": datetime.fromtimestamp(sample["captured_at"], timezone.utc).strftime("%H:%M"), "cpu": sample["cpu"], "memory": sample["memory"]} for sample in self.storage.samples_since(int(time.time()) - 1800)][-12:],
        }
