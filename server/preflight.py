#!/usr/bin/env python3
"""Read-only CastoriceUI host preflight; never installs, reloads, or restarts."""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
try:
    import pwd
    import grp
except ImportError:
    pwd = grp = None
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from castoriceui.protocol_probe import owned_listeners  # noqa: E402
from castoriceui.nginx_site import panel_site  # noqa: E402
from castoriceui.host_permissions import check_config, check_state  # noqa: E402


def command(*arguments: str, timeout: float = 8) -> tuple[bool, str]:
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode == 0, (result.stdout or result.stderr).strip()[:65536]
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, type(error).__name__


def loaded_nginx() -> tuple[bool, str]:
    """Bound the parsed dump independently of short human-facing logs."""
    try:
        with tempfile.TemporaryFile() as output:
            result = subprocess.run(("nginx", "-T"), stdout=output, stderr=subprocess.DEVNULL, timeout=15, check=False)
            if result.returncode:
                return False, "Nginx configuration is unavailable"
            output.seek(0)
            data = output.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024:
            return False, "Loaded Nginx configuration exceeds the 16 MiB inspection limit"
        return True, data.decode("utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return False, "Nginx configuration could not be read in 15 seconds"


def report_checks(checks: list[dict[str, Any]]) -> dict[str, Any]:
    failed = {item["name"] for item in checks if item["status"] == "fail"}
    if not failed:
        return {"ok": True, "mutationFree": True, "checks": checks, "exitCode": 0}
    category, code = ("preflight_failed", 2)
    if any(name.startswith("command-") for name in failed) or failed & {"yaml-parser", "python-version"}:
        category, code = ("missing_dependency", 69)
    elif "backend-port" in failed:
        category, code = ("port_conflict", 73)
    elif failed & {"protected-config", "protected-config-permissions", "data-permissions", "service-permissions"}:
        category, code = ("unsafe_configuration", 78)
    return {"ok": False, "mutationFree": True, "checks": checks, "errorCategory": category, "exitCode": code}


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

    for executable in ("python3", "nginx", "systemctl", "ping", "ip", "openssl", "runuser"):
        resolved = shutil.which(executable)
        add(f"command-{executable}", "pass" if resolved else "fail", resolved or "not found")
    add("python-version", "pass" if sys.version_info >= (3, 11) else "fail", "Python 3.11 or newer is required")
    if importlib.util.find_spec("yaml") is None:
        add("yaml-parser", "fail", "Install python3-yaml before deployment")
        return report_checks(checks)
    add("yaml-parser", "pass", "PyYAML is available")

    try:
        if pwd is None or grp is None:
            raise KeyError("POSIX accounts unavailable")
        account = pwd.getpwnam("castoriceui")
        grp.getgrnam("proxycert")
        add("service-account", "pass", "castoriceui and proxycert exist")
    except KeyError:
        add("service-account", "fail", "Create castoriceui and proxycert before installing")
        return report_checks(checks)
    try:
        check_config(Path(config_path), account.pw_gid)
    except (OSError, ValueError):
        add("protected-config-permissions", "fail", "Use a real root:castoriceui config file (0640) in protected directories (0750), without ACLs")
        return report_checks(checks)
    from castoriceui.config import AppConfig
    try:
        config = AppConfig.load(config_path)
    except (OSError, ValueError, TypeError):
        add("protected-config", "fail", "Invalid protected configuration; check the schema and configured paths")
        return report_checks(checks)
    add("protected-config", "pass", "Configuration and ownership validated")
    for label, path, directory, optional in (
        ("database", config.database_path, False, True), ("database-wal", config.database_path + "-wal", False, True),
        ("database-shm", config.database_path + "-shm", False, True), ("bootstrap", config.bootstrap_token_path, False, True),
        ("background", config.login_background_directory, True, False),
    ):
        try:
            check_state(Path(path), account.pw_uid, account.pw_gid, directory=directory, optional=optional)
            add("data-permissions", "pass", label)
        except (OSError, ValueError):
            add("data-permissions", "fail", f"{label}: use real paths under /var/lib/castoriceui, owned by castoriceui, mode 0600 for files and 0700 for private directories, without ACLs")
    permission_code = "import os,sys; raise SystemExit(0 if os.access(sys.argv[1],os.R_OK) and os.access(sys.argv[2],os.W_OK|os.X_OK) else 1)"
    permitted, _ = command("runuser", "-u", "castoriceui", "--", "python3", "-c", permission_code, config_path, str(Path(config.database_path).parent))
    add("service-permissions", "pass" if permitted else "fail", "Protected config must be readable and data directory writable by castoriceui")
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
    add("nginx-configuration", "pass" if nginx_ok else "fail", "Run nginx -t on the host for detailed diagnostics" if not nginx_ok else "syntax valid")
    nginx_dump_ok, nginx_dump = loaded_nginx()
    site = panel_site(nginx_dump, config.listen_host, config.listen_port) if nginx_dump_ok else {"ok": False, "reason": nginx_dump}
    add("panel-site", "pass" if site["ok"] else "fail", site["reason"])
    if site["ok"]:
        cert_ok, _ = command("openssl", "x509", "-in", site["certificate"], "-noout", "-checkend", "0")
        for name in site["serverNames"]:
            import ipaddress
            try:
                ipaddress.ip_address(name)
                option = "-checkip"
            except ValueError:
                option = "-checkhost"
            matches, match_output = command("openssl", "x509", "-in", site["certificate"], "-noout", option, name)
            # Older OpenSSL x509 versions can exit zero after a mismatch.
            # Require its affirmative result as well as successful execution.
            cert_ok = cert_ok and matches and "does match certificate" in match_output
        add("panel-certificate", "pass" if cert_ok and Path(site["key"]).is_file() else "fail", "Panel certificate must be readable, unexpired, match the panel names, and have its key")
    return report_checks(checks)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/castoriceui/config.json")
    parser.add_argument("--public-url", help="Also verify the real public HTTPS origin after installation")
    arguments = parser.parse_args()
    report = inspect(arguments.config)
    if arguments.public_url:
        public = inspect_public(arguments.public_url)
        report["public"] = public
        report["ok"] = report["ok"] and public["ok"]
        if not public["ok"] and report["exitCode"] == 0:
            report.update(errorCategory="public_https_failed", exitCode=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(report["exitCode"])


def inspect_public(url: str) -> dict:
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        return {"ok": False, "errorCategory": "invalid_public_origin"}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
    try:
        with opener.open(url.rstrip('/') + '/api/v2/health', timeout=10) as response:
            health = json.loads(response.read(8192))
        with opener.open(url.rstrip('/') + '/', timeout=10) as response:
            static_ok = response.status == 200 and b'<html' in response.read(65536).lower()
        try:
            with opener.open(url.rstrip('/') + '/api/v2/dashboard', timeout=10) as response:
                unauthorized = response.status
        except urllib.error.HTTPError as error:
            unauthorized = error.code
        return {"ok": health.get("status") == "ok" and static_ok and unauthorized == 401, "version": health.get("version"), "staticOk": static_ok, "unauthenticatedDashboard": unauthorized, "tlsVerified": True}
    except (OSError, ValueError, urllib.error.URLError) as error:
        return {"ok": False, "errorCategory": type(error).__name__}


if __name__ == "__main__":
    main()
