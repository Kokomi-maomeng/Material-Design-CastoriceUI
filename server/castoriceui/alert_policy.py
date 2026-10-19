"""Actionable alert levels, quiet observation windows and historical presentation."""
from __future__ import annotations
import json
import time
from typing import Any


def level(payload: dict[str, Any]) -> str:
    key, reason = str(payload.get("id", "")), payload.get("reason", "")
    if key.startswith(("collector-", "integration-", "network-probe-")) or key == "certificate-evidence":
        return "info"
    if key.startswith("monitor-"):
        return "warning" if reason == "certificate_maintenance_failed" else "info"
    if key == "certificate-unreadable":
        return "info"
    if key == "traffic-threshold":
        used = (payload.get("evidence") or {}).get("usedPercent")
        if isinstance(used, (int, float)):
            return "critical" if used >= 100 else "warning" if used >= 90 else "info"
    if key.startswith("network-"):
        metrics = (payload.get("evidence") or {})
        loss, latency = metrics.get("loss"), metrics.get("latency")
        threshold = (metrics.get("effectivePolicy") or {}).get("latencyMs") or 150
        if isinstance(loss, (int, float)) and loss >= 20 or isinstance(latency, (int, float)) and latency >= max(300, 2 * float(threshold)):
            return "warning"
        return "info"
    return payload.get("severity", "info")


def sql_level(encoded: str) -> str:
    try:
        return level(json.loads(encoded))
    except (ValueError, TypeError, AttributeError):
        return "info"


def present(payload: dict[str, Any]) -> dict[str, Any]:
    """Do not rewrite original stored observations when wording/levels change."""
    result = dict(payload)
    result["severity"] = level(payload)
    key, reason = str(payload.get("id", "")), payload.get("reason", "")
    metrics = payload.get("evidence") or {}
    if key.startswith("network-"):
        result["logRef"] = {"domain": "network", "target": key.removeprefix("network-probe-") if key.startswith("network-probe-") else key[8:]}
    elif key.startswith("service-"):
        result["logRef"] = {"domain": "lifecycle", "target": "cores"}
    elif key.startswith("monitor-"):
        result["logRef"] = {"domain": "protocol", "target": "singbox"}
    else:
        result["logRef"] = {"domain": "resource", "target": "backend"}
    title_zh = title_en = detail_zh = detail_en = ""
    if key.startswith("collector-"):
        zh, en = {"system": ("主机指标", "Host metrics"), "runtime": ("服务状态", "Service status"), "network": ("网络测量", "Network measurements")}.get(key[10:], ("监控数据", "Monitoring data"))
        title_zh, title_en = f"{zh}采集暂时中断", f"{en} collection is interrupted"
        detail_zh, detail_en = "请检查面板后台采集任务是否正常运行", "Check that the panel's collection tasks are running"
    elif key.startswith("monitor-") and result["severity"] == "info":
        if "singbox-inventory" in key or reason in {"inventory_missing", "inventory_stale", "inventory_invalid", "inventory_permission_denied", "core_generation_changed", "probe_unavailable"}:
            title_zh, title_en = "协议监听检查暂不可用", "Protocol listener checks are unavailable"
            detail_zh, detail_en = "请检查 castoriceui-protocol-probe 采集任务；协议运行状态可在服务页查看", "Check the castoriceui-protocol-probe task; service status is on the Services page"
        else:
            name = {"monitor-hysteria2": "HY2", "monitor-singbox-statistics": "sing-box", "monitor-anytls": "AnyTLS"}.get(key, key.removeprefix("monitor-"))
            title_zh, title_en = f"{name} 统计暂未更新", f"{name} statistics are not updating"
            detail_zh, detail_en = "请检查服务的本地统计接口和面板接入配置", "Check the service's local statistics API and panel integration settings"
    elif key == "certificate-evidence":
        title_zh, title_en = "证书自动检查暂不可用", "Automatic certificate checks are unavailable"
        detail_zh, detail_en = "请检查站点证书连接和续期任务", "Check the site's certificate connection and renewal task"
    elif key in {"certificate-unreadable", "certificate-expiring", "certificate-expired"}:
        title_zh, title_en = {"certificate-unreadable": ("证书文件暂无法读取", "The certificate file cannot be read"), "certificate-expiring": ("TLS 证书即将过期", "The TLS certificate expires soon"), "certificate-expired": ("TLS 证书已过期", "The TLS certificate has expired")}[key]
        detail_zh, detail_en = ("请检查面板的证书路径和读取权限", "Check the panel's certificate path and read permissions") if key == "certificate-unreadable" else ("请检查证书续期任务，并确认有效证书已应用到服务", "Check the renewal task and confirm the service uses a valid certificate")
    elif key.startswith("network-probe-"):
        title_zh = str(payload.get("titleZh", "网络探测暂不可用"))
        title_en = str(payload.get("titleEn", "Network probes are unavailable"))
        detail_zh, detail_en = "请检查探测工具、地址解析和出站权限", "Check the probe tool, DNS resolution and outbound permissions"
    elif key.startswith("network-"):
        name = str(payload.get("targetName") or payload.get("titleZh") or payload.get("titleEn") or key[8:])
        for suffix in (" 网络质量下降", " 持续轻度波动", " network quality degraded"):
            name = name.removesuffix(suffix)
        result["targetName"] = name
        loss, latency = metrics.get("loss"), metrics.get("latency")
        if loss == 100:
            title_zh, title_en = f"{name} 探测连续无响应", f"{name} is not responding to probes"
            detail_zh, detail_en = "ICMP 探测连续未收到回复，请检查目标连通性", "ICMP probes received no replies; check connectivity to the target"
        elif loss is None and latency is None:
            if payload.get("status") == "resolved":
                title_zh, title_en = f"{name} 曾出现网络测量波动", f"{name} had a network measurement fluctuation"
                detail_zh, detail_en = str(payload.get("descriptionZh") or payload.get("description", "")), str(payload.get("descriptionEn") or payload.get("description", ""))
            else:
                title_zh, title_en = f"{name} 等待网络恢复检查", f"{name} is awaiting a network recovery check"
                detail_zh, detail_en = "本轮探测未完成，等待下一轮测量", "This probe round is incomplete; waiting for the next measurement"
        else:
            title_zh, title_en = (f"{name} 持续轻度波动", f"{name} has a sustained minor fluctuation") if result["severity"] == "info" else (f"{name} 网络质量持续下降", f"{name} has sustained network degradation")
            readings_zh, readings_en = [], []
            if isinstance(latency, (int, float)):
                readings_zh.append(f"延迟 {latency:g} ms"); readings_en.append(f"Latency {latency:g} ms")
            if isinstance(loss, (int, float)):
                readings_zh.append(f"丢包 {loss:g}%"); readings_en.append(f"loss {loss:g}%")
            detail_zh, detail_en = " · ".join(readings_zh), " · ".join(readings_en)
    elif key.startswith("integration-"):
        title_zh = str(payload.get("titleZh", "数据接入暂不可用")).replace("需要检查", "数据暂不可用")
        title_en = str(payload.get("titleEn", "Integration data unavailable")).replace("requires attention", "data are unavailable")
    if title_zh:
        result.update(titleZh=title_zh, titleEn=title_en, title=title_en)
    if detail_zh:
        result.update(descriptionZh=detail_zh, descriptionEn=detail_en, description=detail_en)
    return result


class AlertPolicy:
    def __init__(self) -> None:
        self.since: dict[str, float] = {}

    def apply(self, candidates: list[dict], previous: list[dict], *, now: float | None = None, prune: bool = True) -> list[dict]:
        now = time.monotonic() if now is None else now
        active = {item["id"]: item for item in previous}
        seen, result = set(), []
        collector_ids = {item["id"].removeprefix("collector-") for item in candidates if str(item["id"]).startswith("collector-")}
        for candidate in candidates:
            item = present(candidate)
            key, reason = item["id"], item.get("reason", "")
            if key.startswith("network-") and key in active and not any(isinstance((item.get("evidence") or {}).get(metric), (int, float)) for metric in ("loss", "latency")):
                item["severity"] = active[key]["severity"]
            if reason == "recovery_unconfirmed" and key.startswith("service-"):
                item["severity"] = "critical"
                name = key.removeprefix("service-")
                item.update(titleZh=f"{name} 离线后尚未完成恢复检查", titleEn=f"{name} outage is awaiting a recovery check", title=f"{name} outage is awaiting a recovery check", descriptionZh="请检查服务状态与监听检查任务；检查成功前保留本次离线告警", descriptionEn="Check the service and listener probe; this outage remains open until recovery is verified")
            if key.startswith("integration-"):
                domain = {"traffic": "system", "connections": "runtime", "system": "system", "network": "network"}.get(key[12:])
                if domain in collector_ids or key in {"integration-alerts", "integration-audit"}:
                    continue
            if key in seen:
                continue
            seen.add(key)
            first = self.since.setdefault(key, now)
            delay = 300 if item["severity"] == "info" and not key.startswith(("network-", "traffic-")) else 180 if item["severity"] == "info" and key.startswith("network-") else 0
            if key in active or now - first >= delay:
                result.append(item)
        if prune:
            self.since = {key: value for key, value in self.since.items() if key in seen}
        return result
