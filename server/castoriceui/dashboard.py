from __future__ import annotations

import threading
import time
import copy
import ipaddress
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .collectors import (
    SystemCollector,
    billing_cycle_start,
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
        self.connection_baseline: dict[str, tuple[float, int, int]] = {}
        saved_targets = storage.get_setting("network_targets", None)
        if isinstance(saved_targets, list):
            config.network_targets = saved_targets
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
        if integration_id == "system":
            node_name = values.get("nodeName", "").strip()
            if node_name:
                if len(node_name) > 80:
                    raise ValueError("Node name must be at most 80 characters")
                self.config.node_name = node_name
        elif integration_id == "hysteria2":
            self.config.hysteria_api.update({"url": values.get("endpoint", "")})
        elif integration_id in {"anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"}:
            self.config.singbox_api.update({"url": values.get("endpoint", "")})
            tags = [tag.strip() for tag in values.get("inboundTags", "").split(",") if tag.strip()]
            adapter = {"inboundTags": tags}
            if integration_id == "vless":
                adapter["securityProfile"] = values.get("securityProfile", "standard")
            self.config.protocol_adapters[integration_id] = adapter
        elif integration_id == "traffic":
            interface = values.get("interface", "").strip()
            if interface:
                interface = validate_interface_name(interface)
                self.config.interface = interface
                self.system_collector.interface = interface
            quota = values.get("quotaGb", "").strip()
            if quota:
                quota_bytes = round(float(quota) * 1_000_000_000)
                if quota_bytes < 1_000_000_000:
                    raise ValueError("Traffic quota must be at least 1 GB")
                self.storage.set_setting("traffic_limit_bytes", quota_bytes)
            if values.get("billingDay", "").strip():
                self.config.traffic_billing_day = int(values["billingDay"])
            if values.get("billingTimezone", "").strip():
                self.config.traffic_billing_timezone = values["billingTimezone"].strip()
            if values.get("countMode", "").strip():
                self.config.traffic_count_mode = values["countMode"].strip()
            if values.get("initialUsedGb", "").strip():
                self.config.traffic_initial_used_bytes = round(float(values["initialUsedGb"]) * 1_000_000_000)
                self.config.traffic_initial_used_cycle = values.get("initialUsedCycle", "").strip()
        elif integration_id == "subscriptions":
            self.config.subscription_base_url = values.get("baseUrl", "").strip()
        elif integration_id == "network" and values.get("targets", "").strip():
            targets: list[dict[str, Any]] = []
            for index, line in enumerate(values["targets"].splitlines()[:12]):
                if not line.strip():
                    continue
                name, address = self._network_target_parts(line)
                address, version = validate_probe_target(address)
                targets.append({"id": f"custom-{index + 1}", "name": name or address, "provider": "Custom", "address": address, "ipVersion": version})
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
        clean_values = {key: str(value)[:2048] for key, value in values.items() if key in allowed_fields[integration_id]}
        if integration_id == "traffic" and clean_values.get("initialUsedGb", "").strip():
            effective_day = int(clean_values.get("billingDay") or self.config.traffic_billing_day)
            effective_timezone = clean_values.get("billingTimezone") or self.config.traffic_billing_timezone
            clean_values["initialUsedCycle"] = billing_cycle_start(datetime.now(timezone.utc), effective_day, effective_timezone).date().isoformat()
        enabled = bool(payload.get("enabled", True))
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
        if integration_id not in required:
            configured = True
        if not configured:
            raise ValueError("Complete the required fields")
        self._validate_integration(integration_id, clean_values)
        summaries = {
            "hysteria2": "Endpoint saved; connectivity and authentication validated",
            "anytls": "Endpoint saved; connectivity and authentication validated",
            "vless": "sing-box endpoint and VLESS inbound tags validated",
            "socks5": "sing-box endpoint and SOCKS5 inbound tags validated",
            "shadowsocks": "sing-box endpoint and Shadowsocks inbound tags validated",
            "vmess": "sing-box endpoint and VMess inbound tags validated",
            "trojan": "sing-box endpoint and Trojan inbound tags validated",
            "tuic": "sing-box endpoint and TUIC inbound tags validated",
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
        elif integration_id in {"anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"}:
            endpoint = normalize_loopback_endpoint(values["endpoint"])
            secret = str(self.config.singbox_api.get("secret", "")).strip()
            if not secret or secret == "replace-on-server":
                raise ValueError("Configure the sing-box Secret in the protected server config first")
            http_json(endpoint + "/connections", secret, bearer=True, strict=True)
            values["endpoint"] = endpoint
            tags = [tag.strip() for tag in values.get("inboundTags", "").split(",") if tag.strip()]
            if not tags or len(tags) > 20 or any(len(tag) > 80 for tag in tags):
                raise ValueError("Provide 1-20 sing-box inbound tags, each at most 80 characters")
            if len({tag.casefold() for tag in tags}) != len(tags):
                raise ValueError("Inbound tags must be unique")
            values["inboundTags"] = ",".join(tags)
            if integration_id == "vless" and values.get("securityProfile") not in {"standard", "xtls-vision", "reality", "xtls-vision-reality"}:
                raise ValueError("Invalid VLESS security profile")
        elif integration_id == "subscriptions":
            values["baseUrl"] = normalize_https_base_url(values["baseUrl"])
        elif integration_id == "network" and values.get("targets", "").strip():
            for line in values["targets"].splitlines()[:12]:
                if line.strip():
                    _name, address = self._network_target_parts(line)
                    validate_probe_target(address)
        elif integration_id == "traffic":
            if values.get("interface", "").strip():
                values["interface"] = validate_interface_name(values["interface"])
            if values.get("quotaGb", "").strip():
                quota = float(values["quotaGb"])
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
                baseline = float(values["initialUsedGb"])
                if not 0 <= baseline <= 1_000_000:
                    raise ValueError("initialUsedGb must be between 0 and 1000000 decimal GB")
            if values.get("countMode", "").strip() not in {"", "sum", "max"}:
                raise ValueError("countMode must be sum or max")
        elif integration_id == "alerts":
            limits = {"trafficPercent": (0, 100), "lossPercent": (0, 100), "latencyMs": (0, 60_000)}
            for key, (minimum, maximum) in limits.items():
                if values.get(key, "").strip():
                    number = float(values[key])
                    if not minimum <= number <= maximum:
                        raise ValueError(f"{key} must be between {minimum} and {maximum}")

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

    def network(self) -> list[dict[str, Any]]:
        with self.lock:
            if time.monotonic() - self.network_at > 5 or not self.cached_network:
                self.cached_network = network_snapshots(self.config)
                self.network_at = time.monotonic()
            return self.cached_network

    def update_network_targets(self, payload: Any, source_ip: str, actor: str) -> list[dict[str, Any]]:
        if not isinstance(payload, list) or not 1 <= len(payload) <= 12:
            raise ValueError("Configure between 1 and 12 network targets")
        targets: list[dict[str, Any]] = []
        seen_addresses: set[str] = set()
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
            targets.append({
                "id": f"custom-{index + 1}",
                "name": name,
                "provider": "Custom",
                "address": address,
                "ipVersion": version,
                "order": max(1, min(order, 999)),
            })
        targets.sort(key=lambda item: (item["order"], item["name"].casefold()))
        for index, item in enumerate(targets, 1):
            item["id"] = f"custom-{index}"
            item["order"] = index
        with self.lock:
            self.config.network_targets = targets
            self.cached_network = []
            self.network_at = 0.0
            self.storage.set_setting("network_targets", targets)
        self.storage.add_audit("更新网络探测目标", "配置", f"已保存 {len(targets)} 个探测目标", source_ip, actor=actor)
        return targets

    def traffic_series(self) -> dict[str, Any]:
        now = int(time.time())
        definitions = {"1h": (3600, 180), "6h": (6 * 3600, 900), "24h": (86400, 3600), "3day": (3 * 86400, 10800), "7day": (7 * 86400, 21600)}
        samples = self.storage.samples_since(now - 7 * 86400 - 300)

        def series(duration: int, interval: int) -> list[dict[str, Any]]:
            start = now - duration
            buckets: dict[int, dict[str, int]] = {}
            previous: dict[str, Any] | None = None
            for sample in samples:
                if previous is not None and sample["captured_at"] >= start:
                    bucket = (sample["captured_at"] // interval) * interval
                    item = buckets.setdefault(bucket, {"upload": 0, "download": 0})
                    item["upload"] += max(0, sample["tx_bytes"] - previous["tx_bytes"])
                    item["download"] += max(0, sample["rx_bytes"] - previous["rx_bytes"])
                previous = sample
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
                result.append({"label": label, "capturedAt": moment.isoformat().replace("+00:00", "Z"), **values})
            return result

        ranges = {key: series(duration, interval) for key, (duration, interval) in definitions.items()}
        return {"ranges": ranges, "hourly": ranges["24h"], "daily": ranges["7day"]}

    def account_metrics(self, accounts: list[dict[str, Any]], hy2: dict[str, Any]) -> list[dict[str, Any]]:
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
            candidates = [str(account.get("name", "")), str(account.get("id", "")), *(str(value) for value in configured)]
            matches = [candidate for candidate in candidates if candidate and candidate in identities and candidate not in assigned]
            assigned.update(matches)
            mappings.append(matches)
        unmatched_accounts = [index for index, values in enumerate(mappings) if not values]
        unmatched_identities = [identity for identity in identities if identity not in assigned]
        if len(unmatched_accounts) == 1 and len(unmatched_identities) == 1:
            mappings[unmatched_accounts[0]] = [unmatched_identities[0]]
        public_accounts: list[dict[str, Any]] = []
        for account, identities in zip(accounts, mappings):
            public_accounts.append({
                "id": str(account.get("id", ""))[:160],
                "name": str(account.get("name", "account"))[:160],
                "email": str(account.get("email", ""))[:254],
                "status": account.get("status", "active") if account.get("status") in {"active", "disabled", "expiring"} else "active",
                "protocols": [str(value)[:80] for value in account.get("protocols", [])[:20]] if isinstance(account.get("protocols", []), list) else [],
                "expiresAt": str(account.get("expiresAt", ""))[:80],
                "note": str(account.get("note", ""))[:500],
                "usedBytes": sum(int(traffic.get(identity, {}).get("tx", 0)) + int(traffic.get(identity, {}).get("rx", 0)) for identity in identities),
                "onlineDevices": sum(int(online.get(identity, 0)) for identity in identities),
                "quotaBytes": int(self.storage.get_setting("traffic_limit_bytes", self.config.traffic_limit_bytes)),
            })
        return public_accounts

    def aggregate_connections(self, raw_connections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        now = time.monotonic()
        current: dict[str, tuple[float, int, int]] = {}
        groups: dict[tuple[str, str, str], dict[str, Any]] = {}
        for item in raw_connections:
            connection_id = str(item["id"])
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
                groups[key] = {"id": "group-" + str(len(groups) + 1), "protocol": key[0], "account": key[1], "sourceIp": key[2], "ipVersion": item.get("ipVersion"), "connections": 0, "uploadBps": 0, "downloadBps": 0, "connectedAt": item.get("connectedAt"), "uploadedBytes": 0, "downloadedBytes": 0, "details": [], "ratesAvailable": True}
            group = groups[key]
            group["connections"] += 1
            group["uploadedBytes"] += uploaded; group["downloadedBytes"] += downloaded
            group["details"].append(detail)
            if item.get("connectedAt") and (not group["connectedAt"] or str(item["connectedAt"]) < str(group["connectedAt"])):
                group["connectedAt"] = item["connectedAt"]
            if upload_rate is None or download_rate is None:
                group["ratesAvailable"] = False
            else:
                group["uploadBps"] += upload_rate; group["downloadBps"] += download_rate
        self.connection_baseline = current
        for group in groups.values():
            if not group.pop("ratesAvailable"):
                group["uploadBps"] = None; group["downloadBps"] = None
        return list(groups.values())

    def alerts(self, system: dict[str, Any], services: list[dict[str, Any]], network: list[dict[str, Any]]) -> list[dict[str, Any]]:
        alerts: list[dict[str, Any]] = []
        usage = 100 * system["trafficUsedBytes"] / max(1, system["trafficLimitBytes"])
        traffic_threshold = float(self.config.alert_thresholds.get("trafficPercent", 80))
        latency_threshold = float(self.config.alert_thresholds.get("latencyMs", 150))
        loss_threshold = float(self.config.alert_thresholds.get("lossPercent", 5))
        if usage >= traffic_threshold:
            alerts.append({"id": "traffic-threshold", "severity": "critical" if usage >= max(95, traffic_threshold + 10) else "warning", "title": f"Traffic usage reached {usage:.0f}%", "titleEn": f"Traffic usage reached {usage:.0f}%", "titleZh": f"流量使用已达到 {usage:.0f}%", "description": "Review the remaining quota for the configured billing cycle.", "descriptionEn": "Review the remaining quota for the configured billing cycle.", "descriptionZh": "请检查当前自定义计费周期的剩余额度。", "time": "now", "timeEn": "now", "timeZh": "刚刚", "acknowledged": False, "source": "Traffic quota", "sourceEn": "Traffic quota", "sourceZh": "流量额度"})
        for service in services:
            if service["status"] == "stopped":
                alerts.append({"id": f"service-{service['id']}", "severity": "critical", "title": f"{service['name']} is offline", "titleEn": f"{service.get('nameEn', service['name'])} is offline", "titleZh": f"{service.get('nameZh', service['name'])} 已离线", "description": service["detail"], "descriptionEn": service.get("detailEn", service["detail"]), "descriptionZh": service.get("detailZh", service["detail"]), "time": "now", "timeEn": "now", "timeZh": "刚刚", "acknowledged": False, "source": "Service monitor", "sourceEn": "Service monitor", "sourceZh": "服务监控"})
        for target in network:
            if target["status"] == "down" or target["latency"] >= latency_threshold or target["loss"] >= loss_threshold:
                alerts.append({"id": f"network-{target['id']}", "severity": "warning", "title": f"{target['name']} network quality degraded", "titleEn": f"{target['name']} network quality degraded", "titleZh": f"{target['name']} 网络质量下降", "description": f"Latency {target['latency']} ms · loss {target['loss']}%", "descriptionEn": f"Latency {target['latency']} ms · loss {target['loss']}%", "descriptionZh": f"延迟 {target['latency']} ms · 丢包 {target['loss']}%", "time": "latest probe", "timeEn": "latest probe", "timeZh": "最近探测", "acknowledged": False, "source": "Network probe", "sourceEn": "Network probe", "sourceZh": "网络探测"})
        episodes = self.storage.reconcile_alerts([str(alert["id"]) for alert in alerts])
        for alert in alerts:
            episode = episodes[str(alert["id"])]
            alert.update(episode)
        return alerts

    def audit_page(self, page: int, page_size: int, search: str = "", category: str = "") -> dict[str, Any]:
        result = self.storage.audit_page(page, page_size, search, category)
        result["items"] = [
            {
                "id": f"audit-{row['id']}",
                "action": row["action"],
                "category": row["category"],
                "actor": self._mask_identity(row["actor"]) if self.config.redact_live_data else row["actor"],
                "ip": self._mask_ip(row["source_ip"]) if self.config.redact_live_data else row["source_ip"],
                "time": row["created_at"],
                "result": row["result"],
                "detail": row["detail"],
            }
            for row in result["items"]
        ]
        return result

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
            item = {
                "id": str(source.get("id", ""))[:160],
                "account": str(source.get("account", "account"))[:160],
                "tokenHint": str(source.get("tokenHint", ""))[:80],
                "protocols": [str(value)[:80] for value in source.get("protocols", [])[:20]] if isinstance(source.get("protocols", []), list) else [],
                "updatedAt": str(source.get("updatedAt", ""))[:80],
                "lastFetchedAt": str(source.get("lastFetchedAt", ""))[:80],
                "enabled": bool(source.get("enabled", True)),
            }
            if self.config.redact_live_data:
                item["account"] = self._mask_identity(item.get("account", "account"))
            public.append(item)
        return public

    def runtime_integrations(self, hy2: dict[str, Any], singbox: dict[str, Any], network: list[dict[str, Any]]) -> list[dict[str, Any]]:
        states = {item["id"]: item for item in self.config.public_integrations()}

        def update(integration_id: str, *, configured: bool | None = None, ready: bool, summary: str, summary_zh: str) -> None:
            state = states[integration_id]
            if configured is not None:
                state["configured"] = configured
            state["status"] = "ready" if ready else "error" if state["configured"] else "pending"
            state["summary"] = summary
            state["summaryEn"] = summary
            state["summaryZh"] = summary_zh

        hy2_configured = bool(str(self.config.hysteria_api.get("url", "")).strip())
        sb_configured = bool(str(self.config.singbox_api.get("url", "")).strip())
        update("hysteria2", configured=hy2_configured, ready=bool(hy2.get("available")), summary="Traffic Stats API is responding" if hy2.get("available") else "Traffic Stats API is not configured or not responding", summary_zh="Traffic Stats API 响应正常" if hy2.get("available") else "Traffic Stats API 未配置或当前无响应")
        anytls_configured = bool(sb_configured and self.config.protocol_adapters.get("anytls", {}).get("inboundTags"))
        update("anytls", configured=anytls_configured, ready=bool(anytls_configured and singbox.get("available")), summary="sing-box connections API is responding for AnyTLS" if anytls_configured and singbox.get("available") else "AnyTLS is not configured or the sing-box API is unavailable", summary_zh="AnyTLS 的 sing-box 连接 API 响应正常" if anytls_configured and singbox.get("available") else "AnyTLS 未配置或 sing-box API 当前不可用")
        for integration_id, label in (("vless", "VLESS"), ("socks5", "SOCKS5"), ("shadowsocks", "Shadowsocks"), ("vmess", "VMess"), ("trojan", "Trojan"), ("tuic", "TUIC")):
            adapter = self.config.protocol_adapters.get(integration_id, {})
            configured = bool(sb_configured and adapter.get("inboundTags"))
            update(integration_id, configured=configured, ready=bool(configured and singbox.get("available")), summary=f"{label} inbound tags are mapped to the sing-box connection API" if configured and singbox.get("available") else f"{label} is not configured or the sing-box API is unavailable", summary_zh=f"{label} 入站标签已映射到 sing-box 连接 API" if configured and singbox.get("available") else f"{label} 未配置或 sing-box API 当前不可用")
        hy2_streams_ready = bool(hy2.get("endpointStatus", {}).get("streams", hy2.get("available")))
        adapters_ready = bool(hy2_streams_ready or singbox.get("available"))
        update("connections", ready=adapters_ready, summary="Protocol connection snapshots are available; individual fields may be absent" if adapters_ready else "No configured protocol statistics adapter is currently responding", summary_zh="协议连接快照可用；个别字段可能由核心省略" if adapters_ready else "当前没有已配置的协议统计适配器正常响应")
        update("system", ready=True, summary="Local /proc, filesystem and systemd data collected", summary_zh="已采集本机 /proc、文件系统和 systemd 数据")
        update("traffic", ready=True, summary=f"Interface {self.system_collector.interface} deltas persist across counter resets; incomplete cycle coverage is disclosed", summary_zh=f"网卡 {self.system_collector.interface} 增量会跨计数器归零持续累计；周期覆盖不完整时会明确提示")
        subscription_count = len(self.config.subscriptions)
        update("subscriptions", configured=subscription_count > 0 or bool(self.config.subscription_base_url), ready=subscription_count > 0, summary=f"{subscription_count} protected configuration record(s) loaded; publisher reachability is not verified", summary_zh=f"已读取 {subscription_count} 条受保护配置记录；未验证发布器外部可达性")
        reachable = sum(1 for target in network if target.get("status") != "down")
        update("network", configured=bool(self.config.network_targets), ready=bool(network), summary=f"Live probe loop: {reachable}/{len(network)} targets reachable" if network else "No network probe result is available", summary_zh=f"实时探测：{reachable}/{len(network)} 个目标可达" if network else "当前没有网络探测结果")
        update("alerts", ready=True, summary="Local threshold evaluation enabled", summary_zh="本地阈值告警评估已启用")
        update("audit", ready=True, summary="Local audit records loaded from protected storage", summary_zh="已从受保护存储读取本地审计记录")
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
        connections = self.aggregate_connections(connection_snapshots(hy2, singbox, self.config.protocol_adapters))
        integrations = self.runtime_integrations(hy2, singbox, network)
        if self.config.redact_live_data:
            for connection in connections:
                connection["sourceIp"] = self._mask_ip(connection.get("sourceIp"))
                connection["account"] = self._mask_identity(connection.get("account"))
                for detail in connection.get("details", []):
                    detail["sourceIp"] = self._mask_ip(detail.get("sourceIp"))
                    detail["account"] = self._mask_identity(detail.get("account"))
                    if detail.get("destination"):
                        detail["destination"] = None
        traffic = self.traffic_series()
        accounts = self.account_metrics(copy.deepcopy(self.config.managed_accounts), hy2)
        for account in accounts:
            identity = account.get("name", "")
            if self.config.redact_live_data:
                account["name"] = self._mask_identity(identity)
                account["email"] = self._mask_identity(account.get("email", ""))
                if account.get("note"):
                    account["note"] = "已设置备注（内容已隐藏）"
        singbox_label = "AnyTLS" if self.config.integrations.get("anytls", {}).get("configured") and not self.config.protocol_adapters else "sing-box combined"
        protocol = [
            {"name": "Hysteria2", "value": sum(int(v.get("tx", 0)) + int(v.get("rx", 0)) for v in hy2.get("traffic", {}).values())},
            {"name": singbox_label, "value": int(singbox.get("traffic", {}).get("up", 0)) + int(singbox.get("traffic", {}).get("down", 0))},
        ]
        saved_ui_settings = self.storage.get_setting("ui_settings", {})
        if not isinstance(saved_ui_settings, dict):
            saved_ui_settings = {}
        if saved_ui_settings.get("idleTimeoutMinutes", 15) not in {2, 5, 10, 15, 20, 30}:
            saved_ui_settings["idleTimeoutMinutes"] = 15
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
            "integrations": integrations,
            "uiSettings": {
                "showSetup": True,
                "visiblePanels": ["accounts", "connections", "traffic", "subscriptions", "network", "services", "alerts", "audit"],
                "panelTitle": "CastoriceUI",
                "idleTimeoutMinutes": 15,
                **saved_ui_settings,
            },
        }
