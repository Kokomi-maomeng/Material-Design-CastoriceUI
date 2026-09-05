#!/usr/bin/env python3
"""Read-only CastoriceUI host preflight; never installs, reloads, or restarts."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from castoriceui.config import AppConfig  # noqa: E402


def command(*arguments: str, timeout: float = 8) -> tuple[bool, str]:
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode == 0, (result.stdout or result.stderr).strip()[:4000]
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, type(error).__name__


def listening_ports() -> dict[str, set[int]]:
    result = {"tcp": set(), "udp": set()}
    for name, transport in (("tcp", "tcp"), ("tcp6", "tcp"), ("udp", "udp"), ("udp6", "udp")):
        try:
            lines = Path(f"/proc/net/{name}").read_text(encoding="ascii").splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            fields = line.split()
            if len(fields) > 3 and ((transport == "tcp" and fields[3] == "0A") or transport == "udp"):
                result[transport].add(int(fields[1].rsplit(":", 1)[1], 16))
    return result


def inspect(config_path: str) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    def add(name: str, status: str, detail: str) -> None:
        checks.append({"name": name, "status": status, "detail": detail})

    os_release = {}
    try:
        os_release = dict(line.split("=", 1) for line in Path("/etc/os-release").read_text().splitlines() if "=" in line)
    except OSError:
        pass
    os_id = os_release.get("ID", "").strip('"')
    os_version = os_release.get("VERSION_ID", "").strip('"')
    add("operating-system", "pass" if os_id == "debian" and os_version in {"12", "13"} else "warning", f"{os_id or 'unknown'} {os_version or 'unknown'}")

    for executable in ("python3", "nginx", "systemctl"):
        resolved = shutil.which(executable)
        add(f"command-{executable}", "pass" if resolved else "fail", resolved or "not found")
    try:
        config = AppConfig.load(config_path)
        add("protected-config", "pass", f"valid configuration at {config_path}")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        add("protected-config", "fail", str(error))
        return {"ok": False, "mutationFree": True, "checks": checks}

    for label, value in (("database-parent", Path(config.database_path).parent), ("frontend-root", Path("/var/www/castorice-ui/current"))):
        add(label, "pass" if value.exists() else "warning", str(value))
    if config.certificate_path:
        certificate = Path(config.certificate_path)
        add("certificate-file", "pass" if certificate.is_file() else "fail", str(certificate))
    else:
        add("certificate-file", "warning", "certificate_path is not configured")

    ports = listening_ports()
    add("backend-port", "warning" if config.listen_port in ports["tcp"] else "pass", f"TCP {config.listen_host}:{config.listen_port} {'already listens' if config.listen_port in ports['tcp'] else 'is free'}")
    for port, transport in ((443, "tcp"), (443, "udp")):
        add(f"public-{transport}-{port}", "info", f"{transport.upper()} {port} {'has a listener' if port in ports[transport] else 'has no listener'}")

    for unit in (config.nginx_unit, config.singbox_unit, config.hysteria_unit):
        ok, output = command("systemctl", "show", unit, "-p", "LoadState", "-p", "ActiveState")
        add(f"unit-{unit}", "pass" if ok else "warning", output or "not available")
    nginx_ok, nginx_output = command("nginx", "-t")
    add("nginx-configuration", "pass" if nginx_ok else "fail", nginx_output or "no output")
    failed = [item for item in checks if item["status"] == "fail"]
    return {"ok": not failed, "mutationFree": True, "checks": checks}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/castoriceui/config.json")
    arguments = parser.parse_args()
    report = inspect(arguments.config)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
