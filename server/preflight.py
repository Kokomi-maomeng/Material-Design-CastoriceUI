#!/usr/bin/env python3
"""Read-only CastoriceUI host preflight; never installs, reloads, or restarts."""
from __future__ import annotations

import argparse
import json
import shutil
try:
    import pwd
    import grp
except ImportError:
    pwd = grp = None
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from castoriceui.config import AppConfig  # noqa: E402
from castoriceui.protocol_probe import owned_listeners  # noqa: E402


def command(*arguments: str, timeout: float = 8) -> tuple[bool, str]:
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode == 0, (result.stdout or result.stderr).strip()[:65536]
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
    add("independent-fresh-host-acceptance", "info", "Host-local preflight cannot replace independent Debian VM installation and reboot acceptance; retain the corresponding CI evidence")

    for executable in ("python3", "nginx", "systemctl", "ping", "ip"):
        resolved = shutil.which(executable)
        add(f"command-{executable}", "pass" if resolved else "fail", resolved or "not found")
    add("python-version", "pass" if sys.version_info >= (3, 11) else "fail", "Python 3.11 or newer is required")
    try:
        import yaml
        add("yaml-parser", "pass", yaml.__version__)
    except ImportError:
        add("yaml-parser", "fail", "Install python3-yaml before deployment")
    try:
        config = AppConfig.load(config_path)
        add("protected-config", "pass", f"valid configuration at {config_path}")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        add("protected-config", "fail", str(error))
        return {"ok": False, "mutationFree": True, "checks": checks}

    try:
        if pwd is None or grp is None:
            raise KeyError("POSIX accounts unavailable")
        account = pwd.getpwnam("castoriceui")
        grp.getgrnam("proxycert")
        add("service-account", "pass", "castoriceui and proxycert exist")
    except KeyError:
        account = None
        add("service-account", "fail", "Create castoriceui and proxycert before installing")
    if account is not None:
        permission_code = "import os,sys; raise SystemExit(0 if os.access(sys.argv[1],os.R_OK) and os.access(sys.argv[2],os.W_OK|os.X_OK) else 1)"
        permitted, _ = command("runuser", "-u", "castoriceui", "--", "python3", "-c", permission_code, config_path, str(Path(config.database_path).parent))
        add("service-permissions", "pass" if permitted else "fail", "Protected config must be readable and data directory writable by castoriceui")
    config_file = Path(config_path).resolve()
    permitted_layout = config_file.is_relative_to("/etc/castoriceui") and all(Path(str(getattr(config, key))).resolve().is_relative_to("/var/lib/castoriceui") for key in ("database_path", "bootstrap_token_path", "login_background_directory"))
    add("installer-layout", "pass" if permitted_layout else "fail", "Installer requires config under /etc/castoriceui and writable data under /var/lib/castoriceui")
    add("protocol-status-layout", "pass" if Path(config.protocol_status_path).resolve().is_relative_to("/run/castoriceui") else "fail", "Read-only probe output must stay under /run/castoriceui")

    for label, value in (("database-parent", Path(config.database_path).parent), ("frontend-root", Path("/var/www/castorice-ui/current"))):
        add(label, "pass" if value.exists() else "warning", str(value))
    if config.certificate_path:
        certificate = Path(config.certificate_path)
        add("certificate-file", "pass" if certificate.is_file() else "fail", str(certificate))
    else:
        add("certificate-file", "warning", "certificate_path is not configured")

    ports = listening_ports()
    port_used = config.listen_port in ports["tcp"]
    panel_ok, panel_output = command("systemctl", "show", "castoriceui-backend", "-p", "MainPID", "--value")
    try:
        panel_listens = ("tcp", config.listen_port) in owned_listeners(Path("/proc") / str(int(panel_output))) if panel_ok and int(panel_output) > 0 else False
    except (ValueError, OSError):
        panel_listens = False
    add("backend-port", "fail" if port_used and not panel_listens else "pass", "Existing CastoriceUI listener" if panel_listens else "Port is occupied by another process" if port_used else "Port is free")
    for port, transport in ((443, "tcp"), (443, "udp")):
        add(f"public-{transport}-{port}", "info", f"{transport.upper()} {port} {'has a listener' if port in ports[transport] else 'has no listener'}")

    for unit, required in ((config.nginx_unit, True), (config.singbox_unit, bool(config.singbox_api.get("url") or config.protocol_adapters)), (config.hysteria_unit, bool(config.hysteria_api.get("url")))):
        ok, output = command("systemctl", "show", unit, "-p", "LoadState", "-p", "ActiveState")
        properties = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
        present = ok and properties.get("LoadState") == "loaded"
        active = properties.get("ActiveState") == "active"
        add(f"unit-{unit}", "pass" if present and active else "fail" if required else "info", "loaded and active" if present and active else "Required unit is missing or inactive" if required else "Optional unconfigured core")
    nginx_ok, nginx_output = command("nginx", "-t")
    add("nginx-configuration", "pass" if nginx_ok else "fail", nginx_output or "no output")
    nginx_dump_ok, nginx_dump = command("nginx", "-T")
    add("panel-site", "pass" if nginx_dump_ok and "/var/www/castorice-ui/current" in nginx_dump and "proxy_pass http://" in nginx_dump else "fail", "An enabled TLS panel site with the versioned frontend root and API upstream is required")
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
