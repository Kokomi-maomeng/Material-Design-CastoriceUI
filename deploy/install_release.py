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
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path
from pathlib import PurePosixPath

MAINTENANCE = Path("/run/castoriceui/installing")


class InstallError(RuntimeError):
    def __init__(self, category: str, message: str, code: int = 1):
        super().__init__(message)
        self.category, self.code = category, code


def immutable_path(path: Path, *, directory: bool = True) -> None:
    """Reject symlinks, ACLs and non-root write access in executable paths."""
    if path != path.resolve(strict=True):
        raise ValueError("Release paths must not contain symlinks")
    for part in (path, *path.parents):
        info = part.lstat()
        expected = stat.S_ISREG(info.st_mode) if part == path and not directory else stat.S_ISDIR(info.st_mode)
        if (not expected or info.st_uid != 0 or info.st_mode & 0o022
                or set(os.listxattr(part, follow_symlinks=False)) & {"system.posix_acl_access", "system.posix_acl_default", "security.capability"}):
            raise ValueError("Release files and their parents must be root-owned without unprivileged write access or ACLs")


def immutable_tree(root: Path) -> None:
    immutable_path(root)
    for path, dirs, files in os.walk(root):
        for name in (*dirs, *files):
            entry = Path(path) / name
            info = entry.lstat()
            regular = name in files and stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            if not (regular or stat.S_ISDIR(info.st_mode)) or info.st_uid != 0 or info.st_mode & 0o022 or (
                set(os.listxattr(entry, follow_symlinks=False)) & {"system.posix_acl_access", "system.posix_acl_default", "security.capability"}
            ):
                raise ValueError("Release must contain only protected directories and single-link regular files")


def command(*args: str, check: bool = True, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode})")
    return result


def system_state(unit: str) -> dict[str, str]:
    output = command("systemctl", "show", unit, "-p", "LoadState", "-p", "ActiveState", "-p", "MainPID", "-p", "ExecMainStartTimestampMonotonic", check=False).stdout
    state = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
    state["enabled"] = command("systemctl", "is-enabled", unit, check=False).stdout.strip()
    return state


def allow_login_image_blobs(site_text: str) -> str:
    """Extend only explicit image sources in the project's quoted CSP headers.

    Decoded images use local object URLs. Do not enable blob scripts, remote
    sources, unsafe-eval, or change any other directive/operator setting.
    """
    def policy(header: re.Match) -> str:
        def images(directive: re.Match) -> str:
            sources = directive[3].split()
            if "blob:" in sources:
                return directive[0]
            sources = [source for source in sources if source != "'none'"]
            return directive[1] + directive[2] + " ".join([*sources, "blob:"])
        value = re.sub(r"(^|;)(\s*img-src\s+)([^;]*)", images, header[2], flags=re.IGNORECASE)
        return header[1] + value + header[3]
    return re.sub(r'(\badd_header\s+Content-Security-Policy\s+")([^"\r\n]*)(")', policy, site_text, flags=re.IGNORECASE)


def protect_html_updates(site_text: str) -> str:
    """Deterministic archive times cannot validate a changed HTML entry point.

    Nginx's default ETag contains only mtime and length. Different releases can
    therefore share it. Always send the current shell, even if a browser sends
    validators cached before this policy was installed. Hashed assets retain
    their independent immutable cache policy.
    """
    changed = 0
    def location(match: re.Match) -> str:
        nonlocal changed
        body = match[2]
        if not re.search(r"\btry_files\s+[^;]*/index\.html\s*;", body):
            return match[0]
        changed += 1
        body = re.sub(r"(?m)^[ \t]*(?:etag\s+(?:on|off)|if_modified_since\s+\w+)[ \t]*;[ \t]*\r?\n", "", body)
        body, count = re.subn(r'\badd_header\s+Cache-Control\s+"[^"]*"(?:\s+always)?\s*;', 'add_header Cache-Control "no-store" always;', body, flags=re.IGNORECASE)
        if count != 1:
            raise ValueError("Expected one HTML Cache-Control header")
        return match[1] + "\n        etag off;\n        if_modified_since off;" + body + match[3]
    result = re.sub(r"(\blocation\s+/\s*\{)([^{}]*)(\})", location, site_text)
    if changed != 1:
        raise ValueError("Expected one panel HTML fallback location")
    return result


def backup_database(source: Path, target: Path) -> None:
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as incoming, sqlite3.connect(target) as outgoing:
        incoming.backup(outgoing)
        if outgoing.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite backup integrity check failed")


def release_directory(path: Path) -> None:
    if not path.exists():
        immutable_path(path.parent)
        path.mkdir(mode=0o755)
    immutable_path(path)


def runtime_check(source: Path, config_path: Path, log: Path) -> None:
    """Verify the staged interpreter, imports and config without touching live state."""
    start = time.monotonic()
    args = ("python3", "-I", "-B", "-c",
            "import sys,sqlite3; sys.path.insert(0,sys.argv[1]); "
            "from castoriceui.api import ApiServer; from castoriceui.config import AppConfig; "
            "AppConfig.load(sys.argv[2]); db=sqlite3.connect(':memory:'); "
            "assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok'",
            str(source / "server"), str(config_path))
    state = {"exitCode": None, "timedOut": False}
    try:
        result = command(*args, check=False, timeout=20)
        state["exitCode"] = result.returncode
        if result.returncode:
            raise InstallError("runtime_check_failed", "Staged Python or dependency check failed; see runtime-check.json")
    except subprocess.TimeoutExpired as error:
        state["timedOut"] = True
        raise InstallError("runtime_check_failed", "Staged Python check exceeded 20 seconds") from error
    finally:
        state["elapsedSeconds"] = round(time.monotonic() - start, 3)
        log.write_text(json.dumps(state), encoding="utf-8")


def link(target: Path | None, destination: Path) -> None:
    if target is None:
        destination.unlink(missing_ok=True)
        return
    descriptor, name = tempfile.mkstemp(prefix="." + destination.name + "-", dir=destination.parent)
    os.close(descriptor)
    temporary = Path(name)
    temporary.unlink()
    try:
        temporary.symlink_to(target)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


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
    immutable_path(staging)
    name = f"CastoriceUI-v{version}"
    with tarfile.open(archive, "r:gz") as bundle:
        seen: dict[str, bool] = {}
        total = 0
        for item in bundle:
            path = PurePosixPath(item.name)
            total += item.size
            if len(seen) >= 10_000 or total > 100_000_000:
                raise ValueError("Release archive exceeds size limits")
            if (not path.parts or path.parts[0] != name or item.name != path.as_posix()
                or any(not re.fullmatch(r"[A-Za-z0-9_.-]+", part) or part in {".", ".."} for part in path.parts)
                or item.name in seen or (path.as_posix() != name and not seen.get(path.parent.as_posix()))
                or item.type not in {tarfile.REGTYPE, tarfile.DIRTYPE} or item.pax_headers or item.uid != 0 or item.gid != 0):
                raise ValueError("Unsafe, unordered or duplicate release archive entry")
            mode = 0o755 if item.isdir() or path.parts[1:] == ("deploy", "install-or-upgrade.sh") else 0o644
            if item.mode != mode or item.isdir() and item.size != 0:
                raise ValueError("Incorrect release archive permissions")
            seen[item.name] = item.isdir()
            destination = staging / path
            if item.isdir():
                destination.mkdir(mode=0o755)
            else:
                with bundle.extractfile(item) as source, destination.open("xb") as output:
                    shutil.copyfileobj(source, output)
            destination.chmod(mode)
            if item.isfile():
                os.utime(destination, (item.mtime, item.mtime))
    root = staging / name
    immutable_tree(root)
    for name in ("server/run.py", "server/preflight.py", "server/requirements.txt", "frontend/index.html", "deploy/castoriceui-backend.service", "deploy/castoriceui-protocol-probe.service", "deploy/castoriceui-protocol-probe.timer"):
        if not (root / name).is_file():
            raise ValueError("Release archive is incomplete")
    return root


def install(archive: Path, config_path: Path) -> dict:
    import fcntl
    descriptor = os.open("/run/lock/castoriceui-install.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        if os.fstat(lock.fileno()).st_uid != 0:
            raise ValueError("Installer lock must be owned by root")
        os.fchmod(lock.fileno(), 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise InstallError("installer_locked", "Another CastoriceUI installation is running; retry after it completes", 75) from error
        return _install(archive, config_path)


def _install(archive: Path, config_path: Path) -> dict:
    match = re.fullmatch(r"CastoriceUI-v(\d+\.\d+\.\d+)\.tar\.gz", archive.name)
    if not match:
        raise ValueError("Expected CastoriceUI-vX.Y.Z.tar.gz")
    version = match[1]
    backend_root = Path("/opt/castoriceui")
    frontend_root = Path("/var/www/castorice-ui")
    backend_link, frontend_link = backend_root / "current", frontend_root / "current"
    for root in (backend_root, frontend_root):
        release_directory(root)
        release_directory(root / "releases")
    staging = Path(tempfile.mkdtemp(prefix=f".staging-v{version}-", dir=backend_root / "releases"))
    backup = Path(tempfile.mkdtemp(prefix=f"castoriceui-v{version}-{datetime.datetime.now(datetime.timezone.utc):%Y%m%dT%H%M%SZ}-", dir="/var/backups"))
    os.chmod(backup, 0o700)
    transaction = backup.name
    backend_release = backend_root / "releases" / transaction
    frontend_release = frontend_root / "releases" / transaction
    units = ("castoriceui-backend.service", "castoriceui-protocol-probe.service", "castoriceui-protocol-probe.timer")
    states = {unit: system_state(unit) for unit in units}
    protected_before = {}
    old_links = {backend_link: backend_link.resolve() if backend_link.is_symlink() else None, frontend_link: frontend_link.resolve() if frontend_link.is_symlink() else None}
    modified = False
    stopped = False
    held = False
    site_changed = False
    saved_files: dict[Path, Path | None] = {}
    config = old_config = None
    old_version = None
    db_backup = None
    resume_backend = False
    state = {"phase": "staging", "version": version, "rollbackErrors": [], "unitStates": states, "previousLinks": {str(path): str(target) if target else None for path, target in old_links.items()}}
    def record(phase: str) -> None:
        state["phase"] = phase
        temporary = backup / ".transaction.json"
        temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
        temporary.replace(backup / "transaction.json")
    def save(path: Path, name: str) -> None:
        target = backup / name
        saved_files[path] = target if path.is_file() else None
        if path.is_file():
            shutil.copy2(path, target)
    try:
        if any(path.exists() and not path.is_symlink() for path in old_links):
            raise ValueError("Live panel paths must be symlinks; migrate legacy directories before installing")
        for live, old in old_links.items():
            if old is not None:
                if live.lstat().st_uid != 0 or old.parent != live.parent / "releases":
                    raise ValueError("Current link must be root-owned and point to a sibling release")
                immutable_tree(old)
        source = extract(archive, staging, version)
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(source / "server"))
        import preflight
        report = preflight.inspect(str(config_path))
        (backup / "preflight.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        for item in report["checks"]:
            print(f"Preflight {item['status']}: {item['name']}", flush=True)
        if not report["ok"]:
            raise InstallError(report.get("errorCategory", "preflight_failed"), "Preflight failed; see retained preflight.json", report.get("exitCode", 2))
        if not re.fullmatch(r"/etc/castoriceui/[A-Za-z0-9_./-]+", str(config_path)):
            raise ValueError("Unsupported protected config path")
        runtime_check(source, config_path, backup / "runtime-check.json")
        from castoriceui.config import AppConfig
        from castoriceui.migrations import retired_config
        config = AppConfig.load(config_path)
        protected_units = {value.removesuffix(".service") + ".service" for value in (config.hysteria_unit, config.singbox_unit, config.nginx_unit)}
        protected_before.update({unit: system_state(unit) for unit in protected_units})
        old_unit = Path("/etc/systemd/system/castoriceui-backend.service")
        if old_unit.is_file() and states[units[0]].get("LoadState") == "loaded":
            old_match = re.search(r"--config\s+(\S+)", old_unit.read_text())
            old_config = AppConfig.load(old_match[1] if old_match else "/etc/castoriceui/config.json")
            if Path(old_config.database_path).resolve() != Path(config.database_path).resolve():
                raise ValueError("Upgrade cannot silently change the live database path")
            if states[units[0]].get("ActiveState") == "active":
                old_version = health(old_config).get("version")
                resume_backend = True
        for unit in units:
            save(Path("/etc/systemd/system") / unit, unit)
        event_helper = Path("/usr/local/libexec/castoriceui-core-event.py")
        save(event_helper, "core-event.py")
        event_units = Path("/etc/castoriceui/core-event-units.json")
        save(event_units, "core-event-units.json")
        lifecycle_hooks = []
        for core in (config.singbox_unit, config.hysteria_unit):
            if system_state(core).get("LoadState") == "loaded":
                hook = Path("/etc/systemd/system") / (core.removesuffix(".service") + ".service.d") / "90-castoriceui-lifecycle.conf"
                save(hook, core.removesuffix(".service") + "-lifecycle.conf")
                lifecycle_hooks.append(hook)
        probe_environment = Path("/etc/castoriceui/protocol-probe.env")
        save(probe_environment, "protocol-probe.env")
        save(config_path, "config.json")
        for path, old in old_links.items():
            (backup / (path.parent.name + "-previous-target.txt")).write_text(str(old or ""))
        database = Path(config.database_path)
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
        updated_site = protect_html_updates(allow_login_image_blobs(updated_site))
        shutil.copytree(source, backend_release)
        shutil.copytree(source / "frontend", frontend_release)
        immutable_tree(backend_release)
        immutable_tree(frontend_release)
        record("prepared")
        release_directory(MAINTENANCE.parent)
        with MAINTENANCE.open("x", encoding="utf-8") as gate:
            held = True
            gate.write(transaction + "\n")
        if states[units[0]].get("ActiveState") == "active":
            stopped = True
            command("systemctl", "stop", units[0])
            if system_state(units[0]).get("MainPID") != "0":
                raise RuntimeError("Old backend did not drain")
        if database.exists():
            db_backup = backup / "state.db"
            backup_database(database, db_backup)
        record("quiesced")
        modified = True
        raw_config = json.loads(config_path.read_text(encoding="utf-8"))
        cleaned_config = retired_config(raw_config)
        if cleaned_config != raw_config:
            metadata = config_path.stat()
            config_fd, config_name = tempfile.mkstemp(prefix=".config-", dir=config_path.parent)
            try:
                with os.fdopen(config_fd, "w", encoding="utf-8") as handle:
                    os.fchmod(handle.fileno(), metadata.st_mode & 0o777)
                    os.fchown(handle.fileno(), metadata.st_uid, metadata.st_gid)
                    json.dump(cleaned_config, handle, ensure_ascii=False, indent=2)
                    handle.write("\n")
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(config_name, config_path)
            finally:
                Path(config_name).unlink(missing_ok=True)
        event_helper.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backend_release / "deploy/core-event.py", event_helper)
        os.chmod(event_helper, 0o755)
        event_units.write_text(json.dumps([core.removesuffix(".service") + ".service" for core in (config.singbox_unit, config.hysteria_unit)]))
        os.chmod(event_units, 0o644)
        for hook in lifecycle_hooks:
            hook.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backend_release / "deploy/core-lifecycle.conf.example", hook)
            os.chmod(hook, 0o644)
        for unit in units:
            text = (backend_release / "deploy" / unit).read_text()
            if unit == units[0]:
                text = text.replace("--config /etc/castoriceui/config.json", f"--config {config_path}")
            path = Path("/etc/systemd/system") / unit
            path.write_text(text)
            os.chmod(path, 0o644)
        probe_environment.write_text(f"SING_BOX_UNIT={config.singbox_unit}\nSING_BOX_BINARY={json.dumps(config.singbox_binary, ensure_ascii=False)}\n"
                                     f"CASTORICEUI_PROTOCOL_STATUS={json.dumps(config.protocol_status_path, ensure_ascii=False)}\n")
        os.chmod(probe_environment, 0o640)
        link(backend_release, backend_link)
        link(frontend_release, frontend_link)
        record("switched")
        if updated_site != site_text:
            site_changed = True
            site.write_text(updated_site)
        command("nginx", "-t")
        command("systemctl", "daemon-reload")
        command("systemctl", "enable", "--now", units[2])
        command("systemctl", "start", units[1])
        if states[units[0]].get("LoadState") != "loaded" or states[units[0]]["enabled"] == "enabled":
            command("systemctl", "enable", units[0])
        command("systemctl", "restart", units[0])
        health(config, version)
        if site_changed:
            command("systemctl", "reload", config.nginx_unit)
        if protected_before != {unit: system_state(unit) for unit in protected_before}:
            raise RuntimeError("Proxy or Nginx service state changed during panel deployment")
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Live database integrity failed")
        record("accepted")
        MAINTENANCE.unlink()
        held = False
        return {"version": version, "backup": str(backup), "backend": str(backend_release), "frontend": str(frontend_release), "proxyPidsUnchanged": True}
    except BaseException as failure:
        errors = []
        if modified:
            operations = [("stop-new-backend", lambda: command("systemctl", "stop", units[0]))]
            operations.append(("stop-new-probe-timer", lambda: command("systemctl", "stop", units[2])))
            operations.append(("stop-new-probe", lambda: command("systemctl", "stop", units[1])))
            for unit in (units[0], units[2]):
                if states[unit].get("LoadState") != "loaded":
                    operations.append((f"disable-new-{unit}", lambda unit=unit: command("systemctl", "disable", unit)))
            operations += [(f"restore-{path.name}", lambda path=path, saved=saved: shutil.copy2(saved, path) if saved else path.unlink(missing_ok=True))
                           for path, saved in saved_files.items() if path != site or site_changed]
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
            if site_changed:
                operations += [("nginx-syntax", lambda: command("nginx", "-t")), ("nginx-reload", lambda: command("systemctl", "reload", config.nginx_unit))]
            if old_config is not None and old_version:
                operations.append(("old-panel-health", lambda: health(old_config, old_version)))
            for label, operation in operations:
                try:
                    operation()
                except BaseException as error:
                    errors.append(f"{label}: {type(error).__name__}")
        elif stopped and resume_backend:
            try:
                command("systemctl", "start", units[0])
                health(old_config, old_version)
            except Exception as error:
                errors.append(f"resume-old-backend: {type(error).__name__}")
        for release in (backend_release, frontend_release):
            if release.exists():
                release.rename(release.with_name(release.name + ".failed"))
        state["rollbackErrors"] = errors
        record("rollback-failed" if errors else "rolled-back" if modified else "failed-before-switch")
        print(f"Deployment failed; rollback {'FAILED' if errors else 'verified' if modified else 'not needed'}. Backup: {backup}", file=sys.stderr)
        if errors:
            print(json.dumps(errors), file=sys.stderr)
            raise InstallError("rollback_failed", "Restore the retained transaction before retrying", 4) from failure
        raise
    finally:
        if held:
            MAINTENANCE.unlink(missing_ok=True)
        if staging.parent.resolve() == (backend_root / "releases").resolve() and staging.name.startswith(f".staging-v{version}-"):
            shutil.rmtree(staging)


def main() -> None:
    def terminate(_signum: int, _frame: object) -> None:
        raise InstallError("installer_interrupted", "Installer interrupted; restoring recorded state", 3)
    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--config", default=Path("/etc/castoriceui/config.json"), type=Path)
    args = parser.parse_args()
    try:
        if os.geteuid() != 0:
            raise InstallError("root_required", "Run as root", 2)
        result = install(args.archive.resolve(strict=True), args.config.absolute())
    except Exception as error:
        print(json.dumps({"ok": False, "errorCategory": error.category if isinstance(error, InstallError) else "installation_failed",
                          "message": str(error) if isinstance(error, InstallError) else "See the local transaction and preflight logs"}))
        raise SystemExit(error.code if isinstance(error, InstallError) else 3) from None
    print(json.dumps(result))


if __name__ == "__main__":
    main()
