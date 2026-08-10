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
    hysteria_snapshot,
    network_snapshots,
    service_snapshots,
    singbox_snapshot,
)
from .config import AppConfig
from .storage import Storage


class DashboardService:
    def __init__(self, config: AppConfig, storage: Storage) -> None:
        self.config = config
        self.storage = storage
        self.system_collector = SystemCollector(config, storage)
        self.lock = threading.RLock()
        self.cached_network: list[dict[str, Any]] = []
        self.network_at = 0.0
        overrides = storage.get_setting("integration_overrides", {})
        if isinstance(overrides, dict):
            for integration_id, value in overrides.items():
                if integration_id in config.integrations and isinstance(value, dict):
                    config.integrations[integration_id].update(value)
                    values = value.get("values", {})
                    if isinstance(values, dict):
                        self._apply_integration_values(integration_id, {key: str(item) for key, item in values.items()})

    def _apply_integration_values(self, integration_id: str, values: dict[str, str]) -> None:
        if integration_id == "hysteria2":
            self.config.hysteria_api.update({"url": values.get("endpoint", ""), "secret": values.get("secret", "")})
        elif integration_id == "anytls":
            self.config.singbox_api.update({"url": values.get("endpoint", ""), "secret": values.get("secret", "")})
        elif integration_id == "traffic":
            interface = values.get("interface", "").strip()
            if interface:
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
                try:
                    version = ipaddress.ip_address(address).version
                except ValueError:
                    version = 6 if ":" in address else 4
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

    def configure_integration(self, integration_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        allowed_fields = {
            "hysteria2": {"endpoint", "secret"},
            "anytls": {"endpoint", "secret"},
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
        required = {"hysteria2": {"endpoint", "secret"}, "anytls": {"endpoint", "secret"}, "subscriptions": {"baseUrl"}}
        configured = required.get(integration_id, set()).issubset({key for key, value in clean_values.items() if value.strip()})
        if integration_id not in required:
            configured = True
        summary = "Configuration saved" if configured else "Complete the required fields"
        state = {"enabled": enabled, "configured": configured, "status": "ready" if configured else "pending", "summary": summary, "values": clean_values}
        self._apply_integration_values(integration_id, clean_values)
        overrides = self.storage.get_setting("integration_overrides", {})
        overrides[integration_id] = state
        self.storage.set_setting("integration_overrides", overrides)
        self.config.integrations[integration_id].update(state)
        self.storage.add_audit("更新数据接入", "配置", f"{integration_id} 接入配置已更新")
        return next(item for item in self.config.public_integrations() if item["id"] == integration_id)

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

    def subscription_url(self, subscription_id: str) -> str | None:
        for subscription in self.config.subscriptions:
            if str(subscription.get("id", "")) == subscription_id and subscription.get("enabled", True):
                value = str(subscription.get("url", "")).strip()
                return value or None
        return None

    def snapshot(self) -> dict[str, Any]:
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
            "integrations": self.config.public_integrations(),
            "resourceHistory": [{"label": datetime.fromtimestamp(sample["captured_at"], timezone.utc).strftime("%H:%M"), "cpu": sample["cpu"], "memory": sample["memory"]} for sample in self.storage.samples_since(int(time.time()) - 1800)][-12:],
        }
