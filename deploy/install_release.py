#!/usr/bin/env python3
"""Transactional panel installer. Proxy processes are never changed."""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import signal
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path


def command(*args: str, check: bool = True, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode})")
    return result


def system_state(unit: str) -> dict[str, str]:
    output = command("systemctl", "show", unit, "-p", "LoadState", "-p", "ActiveState", "-p", "MainPID", check=False).stdout
    state = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
    state["enabled"] = command("systemctl", "is-enabled", unit, check=False).stdout.strip()
    return state


def backup_database(source: Path, target: Path) -> None:
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as incoming, sqlite3.connect(target) as outgoing:
        incoming.backup(outgoing)
        if outgoing.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite backup integrity check failed")


def link(target: Path | None, destination: Path) -> None:
    if target is None:
        destination.unlink(missing_ok=True)
        return
    temporary = destination.with_name(destination.name + ".next")
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, destination)


def health(config: object, expected: str | None = None) -> dict:
    host = f"[{config.listen_host}]" if ":" in config.listen_host else config.listen_host
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(30):
        try:
            with opener.open(f"http://{host}:{config.listen_port}/api/v2/health", timeout=2) as response:
                result = json.load(response)
            if result.get("status") == "ok" and (expected is None or result.get("version") == expected):
                return result
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise RuntimeError("Panel health verification failed")


def extract(archive: Path, staging: Path, version: str) -> Path:
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if not members or len(members) > 10_000 or sum(item.size for item in members) > 100_000_000:
            raise ValueError("Release archive exceeds size limits")
        seen = set()
        for item in members:
            path = Path(item.name)
            if path.is_absolute() or ".." in path.parts or item.issym() or item.islnk() or not (item.isfile() or item.isdir()) or item.name in seen or not path.parts or path.parts[0] != f"CastoriceUI-v{version}":
                raise ValueError("Unsafe or duplicate release archive entry")
            seen.add(item.name)
        bundle.extractall(staging)
    root = staging / f"CastoriceUI-v{version}"
    for name in ("server/run.py", "server/preflight.py", "server/requirements.txt", "frontend/index.html", "deploy/castoriceui-backend.service", "deploy/castoriceui-protocol-probe.service", "deploy/castoriceui-protocol-probe.timer"):
        if not (root / name).is_file():
            raise ValueError("Release archive is incomplete")
    return root


def install(archive: Path, config_path: Path) -> dict:
    match = re.fullmatch(r"CastoriceUI-v(\d+\.\d+\.\d+)\.tar\.gz", archive.name)
    if not match:
        raise ValueError("Expected CastoriceUI-vX.Y.Z.tar.gz")
    version = match[1]
    backend_root = Path("/opt/castoriceui")
    frontend_root = Path("/var/www/castorice-ui")
    backend_link, frontend_link = backend_root / "current", frontend_root / "current"
    backend_root.joinpath("releases").mkdir(parents=True, exist_ok=True)
    frontend_root.joinpath("releases").mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".staging-v{version}-", dir=backend_root / "releases"))
    backup = Path(tempfile.mkdtemp(prefix=f"castoriceui-v{version}-{datetime.datetime.now(datetime.timezone.utc):%Y%m%dT%H%M%SZ}-", dir="/var/backups"))
    os.chmod(backup, 0o700)
    transaction = backup.name
    backend_release = backend_root / "releases" / transaction
    frontend_release = frontend_root / "releases" / transaction
    units = ("castoriceui-backend.service", "castoriceui-protocol-probe.service", "castoriceui-protocol-probe.timer")
    states = {unit: system_state(unit) for unit in units}
    proxy_pids = {unit: system_state(unit).get("MainPID") for unit in ("hysteria-server", "sing-box", "nginx")}
    old_links = {backend_link: backend_link.resolve() if backend_link.is_symlink() else None, frontend_link: frontend_link.resolve() if frontend_link.is_symlink() else None}
    modified = False
    saved_files: dict[Path, Path | None] = {}
    config = old_config = None
    old_version = None
    db_backup = None
    state = {"phase": "staging", "version": version, "rollbackErrors": [], "proxyPids": proxy_pids, "unitStates": states, "previousLinks": {str(path): str(target) if target else None for path, target in old_links.items()}}
    def record(phase: str) -> None:
        state["phase"] = phase
        (backup / "transaction.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
    def save(path: Path, name: str) -> None:
        target = backup / name
        saved_files[path] = target if path.is_file() else None
        if path.is_file():
            shutil.copy2(path, target)
    try:
        if any(path.exists() and not path.is_symlink() for path in old_links):
            raise ValueError("Live panel paths must be symlinks; migrate legacy directories before installing")
        source = extract(archive, staging, version)
        sys.path.insert(0, str(source / "server"))
        from castoriceui.config import AppConfig
        import preflight
        config = AppConfig.load(config_path)
        report = preflight.inspect(str(config_path))
        (backup / "preflight.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        for item in report["checks"]:
            print(f"Preflight {item['status']}: {item['name']}", flush=True)
        if not report["ok"]:
            raise RuntimeError("Preflight failed; see retained preflight.json")
        if not re.fullmatch(r"/etc/castoriceui/[A-Za-z0-9_./-]+", str(config_path)):
            raise ValueError("Unsupported protected config path")
        command("python3", "-m", "compileall", "-q", str(source / "server"))
        checked = command("python3", "-m", "unittest", "discover", "-s", str(source / "server/tests"), "-p", "test_*.py", check=False)
        (backup / "backend-tests.log").write_text(checked.stdout + checked.stderr, encoding="utf-8")
        if checked.returncode:
            raise RuntimeError("Staged backend regressions failed")
        old_unit = Path("/etc/systemd/system/castoriceui-backend.service")
        if old_unit.is_file() and states[units[0]].get("LoadState") == "loaded":
            old_match = re.search(r"--config\s+(\S+)", old_unit.read_text())
            old_config = AppConfig.load(old_match[1] if old_match else "/etc/castoriceui/config.json")
            if Path(old_config.database_path).resolve() != Path(config.database_path).resolve():
                raise ValueError("Upgrade cannot silently change the live database path")
            if states[units[0]].get("ActiveState") == "active":
                old_version = health(old_config).get("version")
        for unit in units:
            save(Path("/etc/systemd/system") / unit, unit)
        probe_environment = Path("/etc/castoriceui/protocol-probe.env")
        save(probe_environment, "protocol-probe.env")
        shutil.copy2(config_path, backup / "config.json")
        for path, old in old_links.items():
            (backup / (path.parent.name + "-previous-target.txt")).write_text(str(old or ""))
        database = Path(config.database_path)
        if database.exists():
            db_backup = backup / "state.db"
            backup_database(database, db_backup)
        sites = set()
        for directory in (Path("/etc/nginx/sites-enabled"), Path("/etc/nginx/conf.d")):
            if directory.is_dir():
                sites.update(item.resolve() for item in directory.iterdir() if item.is_file() and "/var/www/castorice-ui/current" in item.read_text())
        if len(sites) != 1:
            raise ValueError("Expected one enabled panel Nginx site")
        site = next(iter(sites))
        save(site, "nginx-site.conf")
        site_text = site.read_text()
        address = f"[{config.listen_host}]" if ":" in config.listen_host else config.listen_host
        updated_site, count = re.subn(r"proxy_pass\s+http://(?:127\.[0-9.]+|\[::1\]):\d+\s*;", f"proxy_pass http://{address}:{config.listen_port};", site_text)
        if count != 1:
            raise ValueError("Panel site must have one unambiguous loopback upstream")
        shutil.copytree(source, backend_release)
        shutil.copytree(source / "frontend", frontend_release)
        record("prepared")
        modified = True
        for unit in units:
            text = (backend_release / "deploy" / unit).read_text()
            if unit == units[0]:
                text = text.replace("--config /etc/castoriceui/config.json", f"--config {config_path}")
            path = Path("/etc/systemd/system") / unit
            path.write_text(text)
            os.chmod(path, 0o644)
        probe_environment.write_text(f"SING_BOX_UNIT={config.singbox_unit}\nCASTORICEUI_PROTOCOL_STATUS={config.protocol_status_path}\n")
        os.chmod(probe_environment, 0o640)
        link(backend_release, backend_link)
        link(frontend_release, frontend_link)
        record("switched")
        site.write_text(updated_site)
        command("nginx", "-t")
        command("systemctl", "daemon-reload")
        command("systemctl", "enable", "--now", units[2])
        command("systemctl", "start", units[1])
        if states[units[0]].get("LoadState") != "loaded" or states[units[0]]["enabled"] == "enabled":
            command("systemctl", "enable", units[0])
        command("systemctl", "restart", units[0])
        health(config, version)
        if updated_site != site_text:
            command("systemctl", "reload", "nginx")
        if proxy_pids != {unit: system_state(unit).get("MainPID") for unit in proxy_pids}:
            raise RuntimeError("Proxy or Nginx PID changed during panel deployment")
        with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Live database integrity failed")
        record("accepted")
        return {"version": version, "backup": str(backup), "backend": str(backend_release), "frontend": str(frontend_release), "proxyPidsUnchanged": True}
    except BaseException:
        errors = []
        if modified:
            operations = [("stop-new-backend", lambda: command("systemctl", "stop", units[0]))]
            operations.append(("stop-new-probe-timer", lambda: command("systemctl", "stop", units[2])))
            operations.append(("stop-new-probe", lambda: command("systemctl", "stop", units[1])))
            for unit in (units[0], units[2]):
                if states[unit].get("LoadState") != "loaded":
                    operations.append((f"disable-new-{unit}", lambda unit=unit: command("systemctl", "disable", unit)))
            operations += [(f"restore-{path.name}", lambda path=path, saved=saved: shutil.copy2(saved, path) if saved else path.unlink(missing_ok=True)) for path, saved in saved_files.items()]
            operations += [(f"restore-{path.parent.name}-link", lambda path=path, old=old: link(old, path)) for path, old in old_links.items()]
            if db_backup is not None:
                operations.append(("restore-database", lambda: backup_database(db_backup, Path(config.database_path))))
            else:
                for suffix in ("", "-wal", "-shm"):
                    operations.append((f"remove-new-database{suffix}", lambda suffix=suffix: Path(str(config.database_path) + suffix).unlink(missing_ok=True)))
            operations.append(("daemon-reload", lambda: command("systemctl", "daemon-reload")))
            for unit in (units[0], units[2]):
                if states[unit].get("LoadState") != "loaded":
                    continue
                enabled = states[unit]["enabled"] == "enabled"
                operations.append((f"restore-{unit}-enable", lambda unit=unit, enabled=enabled: command("systemctl", "enable" if enabled else "disable", unit)))
                active = states[unit].get("ActiveState") == "active"
                operations.append((f"restore-{unit}-active", lambda unit=unit, active=active: command("systemctl", "start" if active else "stop", unit)))
            if states[units[1]].get("ActiveState") == "active":
                operations.append(("restore-probe-active", lambda: command("systemctl", "start", units[1])))
            operations += [("nginx-syntax", lambda: command("nginx", "-t")), ("nginx-reload", lambda: command("systemctl", "reload", "nginx"))]
            if old_config is not None and old_version:
                operations.append(("old-panel-health", lambda: health(old_config, old_version)))
            for label, operation in operations:
                try:
                    operation()
                except BaseException as error:
                    errors.append(f"{label}: {type(error).__name__}")
        for release in (backend_release, frontend_release):
            if release.exists():
                release.rename(release.with_name(release.name + ".failed"))
        state["rollbackErrors"] = errors
        record("rollback-failed" if errors else "rolled-back" if modified else "failed-before-switch")
        print(f"Deployment failed; rollback {'FAILED' if errors else 'verified' if modified else 'not needed'}. Backup: {backup}", file=sys.stderr)
        if errors:
            print(json.dumps(errors), file=sys.stderr)
        raise
    finally:
        if staging.parent.resolve() == (backend_root / "releases").resolve() and staging.name.startswith(f".staging-v{version}-"):
            shutil.rmtree(staging)


def main() -> None:
    def terminate(_signum: int, _frame: object) -> None:
        raise RuntimeError("Installer interrupted; restoring recorded state")
    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--config", default=Path("/etc/castoriceui/config.json"), type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Run as root")
    try:
        result = install(args.archive.resolve(strict=True), args.config.resolve(strict=True))
    except Exception as error:
        raise SystemExit(f"Installer stopped: {type(error).__name__}: {error}") from error
    print(json.dumps(result))


if __name__ == "__main__":
    main()
