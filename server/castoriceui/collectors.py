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


def run(command: list[str], timeout: float = 2.5) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        return (result.stdout or result.stderr).strip() if result.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


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
            "nodeRegion": self.config.node_region,
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


def http_json(url: str, secret: str = "", bearer: bool = False, timeout: float = 2) -> Any:
    headers = {"Accept": "application/json"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}" if bearer else secret
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
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
        traffic = traffic_future.result() or {}
        online = online_future.result() or {}
        stream_data = stream_future.result() or {}
    return {"available": True, "traffic": traffic, "online": online, "streams": stream_data.get("streams", [])}


def singbox_snapshot(config: AppConfig) -> dict[str, Any]:
    api = config.singbox_api
    base = str(api.get("url", "")).rstrip("/")
    if not base:
        return {"available": False, "traffic": {}, "connections": []}
    secret = str(api.get("secret", ""))
    payload = http_json(base + "/connections", secret, bearer=True) or {}
    traffic = {"up": int(payload.get("uploadTotal", 0)), "down": int(payload.get("downloadTotal", 0))}
    return {"available": True, "traffic": traffic, "connections": payload.get("connections", [])}


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


def service_snapshots(config: AppConfig, system: dict[str, Any], hy2: dict[str, Any], sb: dict[str, Any]) -> list[dict[str, Any]]:
    definitions = [
        ("hysteria2", "Hysteria2", "hysteria-server", "bolt", ["/usr/local/bin/hysteria", "version"]),
        ("anytls", "AnyTLS", "sing-box", "encrypted", ["/usr/bin/sing-box", "version"]),
        ("nginx", "Nginx", "nginx", "language", ["nginx", "-v"]),
    ]
    services: list[dict[str, Any]] = []
    def inspect(definition: tuple[str, str, str, str, list[str]]) -> tuple[tuple[str, str, str, str, list[str]], str, int, str]:
        active, uptime = service_state(definition[2])
        version = run(definition[4], timeout=2).splitlines()
        return definition, active, uptime, version[0] if version else "installed"

    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="service") as pool:
        inspected = list(pool.map(inspect, definitions))
    for definition, active, uptime, version in inspected:
        service_id, name, _unit, icon, _command = definition
        adapter = hy2 if service_id == "hysteria2" else sb if service_id == "anytls" else {"available": True}
        detail = "Live data adapter connected" if adapter.get("available") else "Service detected · statistics adapter pending"
        services.append({"id": service_id, "name": name, "detail": detail, "status": "running" if active == "active" else "stopped", "version": version.replace(name, "").strip()[:50] or "installed", "uptimeSeconds": uptime, "icon": icon})
    cert = certificate_info(config.certificate_path)
    services.extend([
        {"id": "kernel", "name": "Linux kernel", "detail": f"{system['cpuCores']} CPU · load {system['load'][0]}", "status": "running", "version": system["kernel"], "uptimeSeconds": int(system["uptimeSeconds"]), "icon": "memory"},
        {"id": "certificate", "name": "TLS certificate", "detail": cert["detail"], "status": cert["status"], "version": "TLS", "uptimeSeconds": 0, "icon": "verified_user"},
        {"id": "updates", "name": "System updates", "detail": "Security updates are reviewed by the operator", "status": "running", "version": "Debian stable", "uptimeSeconds": 0, "icon": "system_update"},
    ])
    return services


def connection_snapshots(hy2: dict[str, Any], sb: dict[str, Any]) -> list[dict[str, Any]]:
    connections: list[dict[str, Any]] = []
    for index, stream in enumerate(hy2.get("streams", [])):
        started = stream.get("initial_at", datetime.now(timezone.utc).isoformat())
        connections.append({"id": f"hy2-{stream.get('connection', index)}-{stream.get('stream', index)}", "protocol": "Hysteria2", "account": str(stream.get("auth", "authenticated")), "sourceIp": "provided by protocol core", "ipVersion": 4, "connections": 1, "uploadBps": 0, "downloadBps": 0, "uploadedBytes": int(stream.get("tx", 0)), "downloadedBytes": int(stream.get("rx", 0)), "connectedAt": started})
    for index, connection in enumerate(sb.get("connections", [])):
        metadata = connection.get("metadata", {})
        source_ip = str(metadata.get("sourceIP", "unknown"))
        connections.append({"id": str(connection.get("id", f"anytls-{index}")), "protocol": "AnyTLS", "account": str(metadata.get("inboundName", "AnyTLS user")), "sourceIp": source_ip, "ipVersion": 6 if ":" in source_ip else 4, "connections": 1, "uploadBps": 0, "downloadBps": 0, "uploadedBytes": int(connection.get("upload", 0)), "downloadedBytes": int(connection.get("download", 0)), "connectedAt": connection.get("start", datetime.now(timezone.utc).isoformat())})
    return connections


def ping_target(target: dict[str, Any]) -> dict[str, Any]:
    address = str(target.get("address", ""))
    version = int(target.get("ipVersion", 4))
    command = ["ping", "-6" if version == 6 else "-4", "-c", "3", "-W", "1", address]
    output = run(command, timeout=4)
    values = [float(value) for value in re.findall(r"time[=<]([0-9.]+)\s*ms", output)]
    loss_match = re.search(r"([0-9.]+)% packet loss", output)
    loss = float(loss_match.group(1)) if loss_match else 100.0
    latency = round(statistics.mean(values), 1) if values else 0.0
    jitter = round(statistics.pstdev(values), 1) if len(values) > 1 else 0.0
    status = "down" if not values else "degraded" if loss >= 5 or latency >= 150 else "healthy"
    return {"id": str(target.get("id", address)), "name": str(target.get("name", address)), "provider": str(target.get("provider", "Custom")), "address": address, "ipVersion": version, "latency": latency, "jitter": jitter, "loss": loss, "status": status, "history": values or [0]}


def network_snapshots(config: AppConfig) -> list[dict[str, Any]]:
    targets = config.network_targets[:12]
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(targets))), thread_name_prefix="probe") as pool:
        return list(pool.map(ping_target, targets))
