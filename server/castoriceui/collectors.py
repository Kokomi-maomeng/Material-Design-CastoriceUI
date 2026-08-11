from __future__ import annotations

import json
import os
import platform
import re
import shutil
import socket
import ssl
import statistics
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import AppConfig
from .storage import Storage


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request: Any, fp: Any, code: int, msg: str, headers: Any, new_url: str) -> None:
        return None


def run(command: list[str], timeout: float = 2.5) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        return (result.stdout or result.stderr).strip() if result.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def run_status(command: list[str], timeout: float = 2.5) -> str:
    """Return bounded command output even when a status command exits non-zero."""
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        return (result.stdout or result.stderr).strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


ANSI_ESCAPE = re.compile(r"(?:\x1B[@-_][0-?]*[ -/]*[@-~])|(?:\x1B\][^\x07]*(?:\x07|\x1B\\))")


def clean_command_output(value: str) -> str:
    cleaned = ANSI_ESCAPE.sub("", value).replace("\r", "\n")
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", cleaned)
    return "\n".join(line.strip() for line in cleaned.splitlines() if line.strip())


def semantic_version(value: str, service_id: str) -> str:
    cleaned = clean_command_output(value)
    patterns = {
        "hysteria2": r"(?i)(?:hysteria\s*)?v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)",
        "anytls": r"(?i)(?:sing-box\s+version\s+)?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)",
        "nginx": r"(?i)nginx(?:\s+version)?:\s*nginx/(\d+\.\d+(?:\.\d+)?)",
    }
    match = re.search(patterns[service_id], cleaned)
    return match.group(1) if match else "installed"


def detect_interface(configured: str) -> str:
    if configured:
        return configured
    output = run(["ip", "-o", "route", "show", "default"])
    match = re.search(r"\bdev\s+(\S+)", output)
    return match.group(1) if match else "eth0"


class SystemCollector:
    def __init__(self, config: AppConfig, storage: Storage) -> None:
        self.config = config
        self.storage = storage
        self.interface = detect_interface(config.interface)
        self.previous_cpu: tuple[int, int] | None = None
        self.previous_net: tuple[float, int, int] | None = None

    @staticmethod
    def _cpu_times() -> tuple[int, int]:
        fields = [int(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
        idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
        return sum(fields), idle

    def cpu_percent(self) -> float:
        current = self._cpu_times()
        if self.previous_cpu is None:
            self.previous_cpu = current
            return 0.0
        total = current[0] - self.previous_cpu[0]
        idle = current[1] - self.previous_cpu[1]
        self.previous_cpu = current
        return round(max(0.0, min(100.0, 100 * (total - idle) / total)), 1) if total else 0.0

    @staticmethod
    def memory() -> tuple[int, int, float]:
        values: dict[str, int] = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, value = line.split(":", 1)
            values[key] = int(value.strip().split()[0]) * 1024
        total = values["MemTotal"]
        used = total - values.get("MemAvailable", values.get("MemFree", 0))
        return total, used, round(100 * used / total, 1)

    def network(self) -> tuple[int, int, float, float]:
        root = Path("/sys/class/net") / self.interface / "statistics"
        rx, tx = int((root / "rx_bytes").read_text()), int((root / "tx_bytes").read_text())
        now = time.monotonic()
        if self.previous_net is None:
            self.previous_net = (now, rx, tx)
            return rx, tx, 0.0, 0.0
        elapsed = max(0.1, now - self.previous_net[0])
        rx_rate = max(0, rx - self.previous_net[1]) / elapsed
        tx_rate = max(0, tx - self.previous_net[2]) / elapsed
        self.previous_net = (now, rx, tx)
        return rx, tx, round(rx_rate), round(tx_rate)

    def snapshot(self) -> dict[str, Any]:
        cpu = self.cpu_percent()
        memory_total, memory_used, memory_pct = self.memory()
        disk = shutil.disk_usage("/")
        rx, tx, download, upload = self.network()
        now = int(time.time())
        self.storage.record_sample(now, rx, tx, cpu, memory_pct)
        limit = int(self.storage.get_setting("traffic_limit_bytes", self.config.traffic_limit_bytes))
        month_start = int(datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())
        month_samples = self.storage.samples_since(month_start)
        if month_samples:
            used = max(0, rx - month_samples[0]["rx_bytes"]) + max(0, tx - month_samples[0]["tx_bytes"])
        else:
            used = 0
        load = os.getloadavg()
        return {
            "nodeName": self.config.node_name,
            "cpuPercent": cpu,
            "cpuCores": os.cpu_count() or 1,
            "memoryPercent": memory_pct,
            "memoryUsedBytes": memory_used,
            "memoryTotalBytes": memory_total,
            "diskPercent": round(100 * disk.used / disk.total, 1),
            "diskUsedBytes": disk.used,
            "diskTotalBytes": disk.total,
            "load": [round(value, 2) for value in load],
            "uptimeSeconds": float(Path("/proc/uptime").read_text().split()[0]),
            "trafficUsedBytes": used,
            "trafficLimitBytes": limit,
            "downloadBps": download,
            "uploadBps": upload,
            "interface": self.interface,
            "kernel": platform.release(),
        }


def http_json(url: str, secret: str = "", bearer: bool = False, timeout: float = 2, strict: bool = False) -> Any:
    headers = {"Accept": "application/json"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}" if bearer else secret
    request = urllib.request.Request(url, headers=headers)
    try:
        opener = urllib.request.build_opener(_NoRedirect) if strict else urllib.request.build_opener()
        with opener.open(request, timeout=timeout) as response:
            return json.load(response)
    except (OSError, ValueError, urllib.error.URLError) as error:
        if strict:
            raise ValueError("Integration endpoint validation failed") from error
        return None


def hysteria_snapshot(config: AppConfig) -> dict[str, Any]:
    api = config.hysteria_api
    base = str(api.get("url", "")).rstrip("/")
    if not base:
        return {"available": False, "traffic": {}, "online": {}, "streams": []}
    secret = str(api.get("secret", ""))
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="hysteria-api") as pool:
        traffic_future = pool.submit(http_json, base + "/traffic", secret)
        online_future = pool.submit(http_json, base + "/online", secret)
        stream_future = pool.submit(http_json, base + "/dump/streams", secret)
        traffic_raw = traffic_future.result()
        online_raw = online_future.result()
        stream_raw = stream_future.result()
    traffic = traffic_raw if isinstance(traffic_raw, dict) else {}
    online = online_raw if isinstance(online_raw, dict) else {}
    stream_data = stream_raw if isinstance(stream_raw, dict) else {}
    endpoint_status = {
        "traffic": isinstance(traffic_raw, dict),
        "online": isinstance(online_raw, dict),
        "streams": isinstance(stream_raw, dict),
    }
    return {
        "available": all(endpoint_status.values()),
        "traffic": traffic,
        "online": online,
        "streams": stream_data.get("streams", []) if isinstance(stream_data.get("streams", []), list) else [],
        "endpointStatus": endpoint_status,
    }


def singbox_snapshot(config: AppConfig) -> dict[str, Any]:
    api = config.singbox_api
    base = str(api.get("url", "")).rstrip("/")
    if not base:
        return {"available": False, "traffic": {}, "connections": []}
    secret = str(api.get("secret", ""))
    payload_raw = http_json(base + "/connections", secret, bearer=True)
    payload = payload_raw if isinstance(payload_raw, dict) else {}
    traffic = {"up": int(payload.get("uploadTotal", 0)), "down": int(payload.get("downloadTotal", 0))}
    connections = payload.get("connections", [])
    return {"available": isinstance(payload_raw, dict), "traffic": traffic, "connections": connections if isinstance(connections, list) else []}


def service_state(unit: str) -> tuple[str, int]:
    output = run(["systemctl", "show", unit, "--property=ActiveState,ActiveEnterTimestampMonotonic", "--value"])
    lines = output.splitlines()
    active = lines[0] if lines else "unknown"
    uptime = 0
    if len(lines) > 1 and lines[1].isdigit():
        uptime = max(0, int(time.monotonic() - int(lines[1]) / 1_000_000))
    return active, uptime


def certificate_info(path: str) -> dict[str, Any]:
    if not path or not Path(path).exists():
        return {"status": "stopped", "detail": "Certificate path is not configured", "days": 0}
    try:
        decoded = ssl._ssl._test_decode_cert(path)  # type: ignore[attr-defined]
        expires = datetime.strptime(decoded["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        days = max(0, int((expires - datetime.now(timezone.utc)).total_seconds() / 86400))
        return {"status": "running" if days > 21 else "warning", "detail": f"{days} days remaining · automatic renewal", "days": days}
    except (OSError, ValueError, KeyError):
        return {"status": "warning", "detail": "Unable to read certificate", "days": 0}


def operating_system_version() -> str:
    try:
        values = {}
        for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                values[key] = value.strip().strip('"')
        return values.get("PRETTY_NAME") or values.get("NAME") or "Linux"
    except OSError:
        return platform.system() or "Linux"


def automatic_update_info() -> dict[str, str]:
    enabled = run_status(["systemctl", "is-enabled", "unattended-upgrades.service"])
    timer = run_status(["systemctl", "is-active", "apt-daily-upgrade.timer"])
    active = enabled in {"enabled", "static"} and timer == "active"
    if active:
        detail = "unattended-upgrades enabled · apt-daily-upgrade timer active"
    else:
        detail = f"automatic update state: service {enabled or 'unknown'} · timer {timer or 'unknown'}"
    return {"status": "running" if active else "warning", "detail": detail, "version": operating_system_version()}


def service_snapshots(config: AppConfig, system: dict[str, Any], hy2: dict[str, Any], sb: dict[str, Any]) -> list[dict[str, Any]]:
    definitions = [
        ("hysteria2", "Hysteria2", "hysteria-server", "bolt", ["/usr/local/bin/hysteria", "version"]),
        ("anytls", "AnyTLS", "sing-box", "encrypted", ["/usr/bin/sing-box", "version"]),
        ("nginx", "Nginx", "nginx", "language", ["nginx", "-v"]),
    ]
    services: list[dict[str, Any]] = []
    def inspect(definition: tuple[str, str, str, str, list[str]]) -> tuple[tuple[str, str, str, str, list[str]], str, int, str]:
        active, uptime = service_state(definition[2])
        version = semantic_version(run(definition[4], timeout=2), definition[0])
        return definition, active, uptime, version

    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="service") as pool:
        inspected = list(pool.map(inspect, definitions))
    for definition, active, uptime, version in inspected:
        service_id, name, _unit, icon, _command = definition
        adapter = hy2 if service_id == "hysteria2" else sb if service_id == "anytls" else None
        if active != "active":
            status, detail, detail_zh = "stopped", "systemd reports the service is not active", "systemd 报告服务未运行"
        elif adapter is None:
            status, detail, detail_zh = "running", "systemd reports active", "systemd 报告服务正在运行"
        elif adapter.get("available"):
            status, detail, detail_zh = "running", "systemd active · statistics adapter responding", "systemd 正常 · 统计适配器响应正常"
        else:
            status, detail, detail_zh = "warning", "systemd active · statistics adapter unavailable", "systemd 正常 · 统计适配器当前不可用"
        services.append({"id": service_id, "name": name, "nameZh": name, "nameEn": name, "detail": detail, "detailZh": detail_zh, "detailEn": detail, "status": status, "version": version, "uptimeSeconds": uptime, "icon": icon})
    cert = certificate_info(config.certificate_path)
    updates = automatic_update_info()
    certificate_zh = "未配置证书路径" if not config.certificate_path else f"证书剩余 {cert['days']} 天" if cert.get("days") else "无法读取证书"
    updates_zh = "无人值守更新与定时器已启用" if updates["status"] == "running" else "自动更新服务或定时器未完全启用"
    services.extend([
        {"id": "kernel", "name": "Linux kernel", "nameZh": "Linux 内核", "nameEn": "Linux kernel", "detail": f"{system['cpuCores']} CPU · load {system['load'][0]}", "detailZh": f"{system['cpuCores']} 核 CPU · 负载 {system['load'][0]}", "detailEn": f"{system['cpuCores']} CPU · load {system['load'][0]}", "status": "running", "version": system["kernel"], "uptimeSeconds": int(system["uptimeSeconds"]), "icon": "memory"},
        {"id": "certificate", "name": "TLS certificate", "nameZh": "TLS 证书", "nameEn": "TLS certificate", "detail": cert["detail"], "detailZh": certificate_zh, "detailEn": cert["detail"], "status": cert["status"], "version": "TLS", "uptimeSeconds": 0, "icon": "verified_user"},
        {"id": "updates", "name": "Automatic updates", "nameZh": "自动更新", "nameEn": "Automatic updates", "detail": updates["detail"], "detailZh": updates_zh, "detailEn": updates["detail"], "status": updates["status"], "version": updates["version"], "uptimeSeconds": 0, "icon": "system_update"},
    ])
    return services


def connection_snapshots(hy2: dict[str, Any], sb: dict[str, Any], protocol_adapters: dict[str, dict[str, Any]] | None = None, default_singbox_protocol: str = "AnyTLS") -> list[dict[str, Any]]:
    connections: list[dict[str, Any]] = []
    tag_protocols: dict[str, str] = {}
    labels = {"vless": "VLESS", "socks5": "SOCKS5", "shadowsocks": "Shadowsocks"}
    for adapter_id, adapter in (protocol_adapters or {}).items():
        for tag in adapter.get("inboundTags", []) if isinstance(adapter, dict) else []:
            if str(tag).strip() and adapter_id in labels:
                tag_protocols[str(tag).strip().casefold()] = labels[adapter_id]
    for index, stream in enumerate(hy2.get("streams", [])):
        started = stream.get("initial_at")
        account = next((str(stream.get(key)) for key in ("auth", "user", "username") if stream.get(key)), "协议核心未提供")
        address_text = " ".join(str(stream.get(key, "")) for key in ("remote_addr", "peer_addr", "source_ip", "remote", "client", "source"))
        ip_match = re.search(r"(?<![0-9A-Fa-f:])(?:\d{1,3}\.){3}\d{1,3}(?!\d)|(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){2,}[0-9A-Fa-f:]+", address_text)
        source_ip = ip_match.group(0) if ip_match else "协议核心未提供"
        destination = str(stream.get("hooked_req_addr") or stream.get("req_addr") or "").strip() or None
        connections.append({"id": f"hy2-{stream.get('connection', index)}-{stream.get('stream', index)}", "protocol": "Hysteria2", "account": account, "sourceIp": source_ip, "ipVersion": 6 if ip_match and ":" in source_ip else 4 if ip_match else None, "connections": 1, "uploadBps": None, "downloadBps": None, "uploadedBytes": int(stream.get("tx", 0)), "downloadedBytes": int(stream.get("rx", 0)), "connectedAt": started, "destination": destination})
    for index, connection in enumerate(sb.get("connections", [])):
        metadata = connection.get("metadata", {})
        source_ip = str(metadata.get("sourceIP") or "协议核心未提供")
        ip_version = 6 if ":" in source_ip else 4 if re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", source_ip) else None
        account = next((str(metadata.get(key)) for key in ("user", "inboundUser", "authUser", "inboundName") if metadata.get(key)), "AnyTLS 用户")
        destination_host = str(metadata.get("host") or metadata.get("destinationIP") or "").strip()
        destination_port = metadata.get("destinationPort")
        destination = f"{destination_host}:{destination_port}" if destination_host and destination_port else destination_host or None
        inbound_tag = str(metadata.get("inbound") or metadata.get("inboundTag") or "").strip()
        protocol = tag_protocols.get(inbound_tag.casefold(), default_singbox_protocol)
        connections.append({"id": str(connection.get("id", f"singbox-{index}")), "protocol": protocol, "account": account, "sourceIp": source_ip, "ipVersion": ip_version, "connections": 1, "uploadBps": None, "downloadBps": None, "uploadedBytes": int(connection.get("upload", 0)), "downloadedBytes": int(connection.get("download", 0)), "connectedAt": connection.get("start"), "destination": destination})
    return connections


def ping_target(target: dict[str, Any]) -> dict[str, Any]:
    address = str(target.get("address", ""))
    version = int(target.get("ipVersion", 4))
    command = ["ping", "-6" if version == 6 else "-4", "-c", "8", "-i", "0.2", "-W", "1", address]
    output = run(command, timeout=4)
    values = [float(value) for value in re.findall(r"time[=<]([0-9.]+)\s*ms", output)]
    loss_match = re.search(r"([0-9.]+)% packet loss", output)
    loss = float(loss_match.group(1)) if loss_match else 100.0
    latency = round(statistics.mean(values), 1) if values else 0.0
    jitter = round(statistics.pstdev(values), 1) if len(values) > 1 else 0.0
    status = "down" if not values else "degraded" if loss >= 5 or latency >= 150 else "healthy"
    return {"id": str(target.get("id", address)), "name": str(target.get("name", address)), "provider": str(target.get("provider", "Custom")), "address": address, "ipVersion": version, "order": int(target.get("order", 0)), "latency": latency, "jitter": jitter, "loss": loss, "status": status, "history": values}


def network_snapshots(config: AppConfig) -> list[dict[str, Any]]:
    targets = config.network_targets[:12]
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(targets))), thread_name_prefix="probe") as pool:
        return list(pool.map(ping_target, targets))
