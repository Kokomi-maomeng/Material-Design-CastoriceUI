"""Read-only root probe. Publish only inbound metadata, never core credentials.

The panel stays unprivileged. This separate timer reads the running sing-box
process's configuration and owned listening sockets without restarting it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any


PROTOCOL_TYPES = {"anytls", "vless", "socks", "mixed", "shadowsocks", "vmess", "trojan", "tuic", "hysteria2"}


def config_paths(arguments: list[str], cwd: Path) -> list[Path]:
    files: list[Path] = []
    directory = cwd
    for index, arg in enumerate(arguments[:-1]):
        if arg in {"-D", "--directory"}:
            directory = Path(arguments[index + 1])
            if not directory.is_absolute():
                directory = cwd / directory
    for index, arg in enumerate(arguments):
        option, sep, inline = arg.partition("=")
        if option not in {"-c", "--config", "-C", "--config-directory"}:
            continue
        raw = inline if sep else arguments[index + 1] if index + 1 < len(arguments) else ""
        if not raw or raw == "-":
            raise ValueError("unreadable_config")
        path = Path(raw)
        if not path.is_absolute():
            path = directory / path
        files.extend(sorted(path.glob("*.json")) if option in {"-C", "--config-directory"} else [path])
    return list(dict.fromkeys(files or [directory / "config.json"]))


def owned_listeners(process: Path) -> set[tuple[str, int]]:
    inodes = set()
    for fd in (process / "fd").iterdir():
        try:
            match = re.fullmatch(r"socket:\[(\d+)\]", os.readlink(fd))
            if match:
                inodes.add(match[1])
        except FileNotFoundError:
            continue
    listeners = set()
    for table, transport in (("tcp", "tcp"), ("tcp6", "tcp"), ("udp", "udp"), ("udp6", "udp")):
        for line in (process / "net" / table).read_text().splitlines()[1:]:
            fields = line.split()
            if len(fields) < 10 or fields[9] not in inodes:
                continue
            if (transport == "tcp" and fields[3] != "0A") or (transport == "udp" and fields[3] != "07"):
                continue
            listeners.add((transport, int(fields[1].rsplit(":", 1)[1], 16)))
    return listeners


def inbound_records(configs: list[dict[str, Any]], listeners: set[tuple[str, int]]) -> list[dict[str, Any]]:
    records = []
    for config in configs:
        for inbound in config.get("inbounds", []):
            kind = inbound.get("type")
            if kind not in PROTOCOL_TYPES:
                continue
            tag = inbound.get("tag", "")
            port = inbound.get("listen_port")
            if not isinstance(tag, str) or not 0 < len(tag) <= 80 or not isinstance(port, int) or not 1 <= port <= 65535:
                continue
            transports = {"udp"} if kind in {"tuic", "hysteria2"} else {"tcp"}
            if kind == "shadowsocks":
                network = inbound.get("network", "")
                transports = {network} if network in {"tcp", "udp"} else {"tcp", "udp"}
            tls = inbound.get("tls") or {}
            reality = bool(tls.get("enabled") and (tls.get("reality") or {}).get("enabled"))
            vision = any(user.get("flow") == "xtls-rprx-vision" for user in inbound.get("users", []))
            profile = "xtls-vision-reality" if vision and reality else "xtls-vision" if vision else "reality" if reality else "standard"
            records.append({"tag": tag, "type": kind, "listening": all((transport, port) in listeners for transport in transports), "securityProfile": profile})
    return records


def collect(unit: str = "sing-box") -> dict[str, Any]:
    result: dict[str, Any] = {"schema": 1, "sampledAt": time.time(), "pid": 0, "available": False, "reason": "core_unavailable", "inbounds": []}
    try:
        output = subprocess.run(["systemctl", "show", unit, "-p", "MainPID", "-p", "ActiveState"], capture_output=True, text=True, timeout=3, check=True).stdout
        properties = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
        pid = int(properties.get("MainPID", "0"))
        result["pid"] = pid
        if properties.get("ActiveState") != "active" or pid <= 0:
            return result
        process = Path("/proc") / str(pid)
        arguments = (process / "cmdline").read_bytes().decode().strip("\0").split("\0")
        if not arguments or Path(arguments[0]).name != "sing-box":
            return result
        started_ticks = int((process / "stat").read_text().rsplit(")", 1)[1].split()[19])
        boot_time = next(int(line.split()[1]) for line in Path("/proc/stat").read_text().splitlines() if line.startswith("btime "))
        started_at = boot_time + started_ticks / os.sysconf("SC_CLK_TCK")
        paths = config_paths(arguments, Path(os.readlink(process / "cwd")))
        if not paths or len(paths) > 100:
            raise ValueError("unreadable_config")
        configs = []
        for path in paths:
            stat = path.stat()
            if stat.st_size > 4_000_000:
                raise ValueError("unreadable_config")
            if stat.st_mtime > started_at + 1:
                raise ValueError("config_not_loaded")
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("unreadable_config")
            configs.append(data)
        controllers = [(item.get("experimental") or {}).get("clash_api", {}).get("external_controller", "") for item in configs]
        controller = next((value for value in reversed(controllers) if value), "")
        result["apiPort"] = int(controller.rsplit(":", 1)[1]) if controller else 0
        result["inbounds"] = inbound_records(configs, owned_listeners(process))
        # A restart during collection invalidates this sample.
        if int((process / "stat").read_text().rsplit(")", 1)[1].split()[19]) != started_ticks:
            return result
        result.update(available=True, reason="verified")
    except ValueError as error:
        result["reason"] = str(error) if str(error) == "config_not_loaded" else "unreadable_config"
    except (OSError, TypeError, KeyError, IndexError, AttributeError, StopIteration, subprocess.SubprocessError):
        result["reason"] = "probe_unavailable"
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unit", default="sing-box")
    parser.add_argument("--output", default="/run/castoriceui/protocol-status.json")
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".protocol-", dir=output.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(collect(args.unit), handle)
            handle.flush()
            os.fchmod(handle.fileno(), 0o644)
        os.replace(temporary, output)
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()


if __name__ == "__main__":
    main()
