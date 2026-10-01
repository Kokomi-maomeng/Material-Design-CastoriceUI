#!/usr/bin/env python3
"""Real systemd/SQLite/Nginx acceptance, ONLY inside an isolated QA VM."""
from __future__ import annotations
import argparse
import http.client
import importlib.util
import json
import os
import shutil
import sqlite3
import ssl
import subprocess
import tarfile
from pathlib import Path


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=check, timeout=180)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--phase", choices=("install", "reboot"), required=True)
    args = parser.parse_args()
    if Path("/etc/hostname").read_text().strip() != "castorice-ci":
        raise SystemExit("This acceptance script is restricted to the isolated castorice-ci VM")
    source = Path("/root/qa-source")
    if args.phase == "install":
        source.mkdir(exist_ok=True)
        with tarfile.open(args.archive) as bundle:
            for member in bundle.getmembers():
                path = Path(member.name)
                if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                    raise ValueError("Unsafe QA release archive")
            bundle.extractall(source)
    release = next(source.glob("CastoriceUI-v*"))
    config_path = Path("/etc/castoriceui/custom-qa.json")
    version = args.archive.name.removeprefix("CastoriceUI-v").removesuffix(".tar.gz")
    if args.phase == "install":
        run("groupadd", "--system", "proxycert")
        run("useradd", "--system", "--user-group", "--home-dir", "/var/lib/castoriceui", "--shell", "/usr/sbin/nologin", "castoriceui")
        run("usermod", "-a", "-G", "proxycert", "castoriceui")
        run("install", "-d", "-m", "0750", "-o", "root", "-g", "castoriceui", "/etc/castoriceui")
        run("install", "-d", "-m", "0700", "-o", "castoriceui", "-g", "castoriceui", "/var/lib/castoriceui", "/var/lib/castoriceui/login-backgrounds")
        run("install", "-d", "/etc/letsencrypt/live/panel.example.com", "/opt/castoriceui/releases", "/var/www/castorice-ui/releases")
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=panel.example.com", "-keyout", "/etc/letsencrypt/live/panel.example.com/privkey.pem", "-out", "/etc/letsencrypt/live/panel.example.com/fullchain.pem")
        config = json.loads((release / "server/config.example.json").read_text())
        config["listen_port"] = 18081
        config["network_targets"] = [{"id": "local", "name": "Local QA", "address": "127.0.0.1", "provider": "Synthetic", "ipVersion": 4, "order": 1}]
        config_path.write_text(json.dumps(config))
        run("chown", "root:castoriceui", str(config_path)); os.chmod(config_path, 0o640)
        site = Path("/etc/nginx/sites-available/castoriceui")
        site.write_text((release / "deploy/nginx.conf.example").read_text())
        Path("/etc/nginx/sites-enabled/castoriceui").symlink_to(site)
        run("nginx", "-t"); run("systemctl", "enable", "--now", "nginx")
        # Fresh-install failure must undo units and links; the next same-version attempt must work.
        specification = importlib.util.spec_from_file_location("qa_installer", release / "deploy/install_release.py")
        module = importlib.util.module_from_spec(specification); specification.loader.exec_module(module)
        real_command = module.command
        injected = [False]
        def failed_start(*arguments, **kwargs):
            if arguments[:3] == ("systemctl", "restart", "castoriceui-backend.service") and not injected[0]:
                injected[0] = True
                raise RuntimeError("Synthetic startup failure")
            return real_command(*arguments, **kwargs)
        module.command = failed_start
        try:
            module.install(args.archive, config_path)
            raise AssertionError("Injected failure did not abort installation")
        except RuntimeError:
            pass
        assert not Path("/opt/castoriceui/current").exists()
        assert not Path("/etc/systemd/system/castoriceui-backend.service").exists()
        module.command = real_command
        accepted = module.install(args.archive, config_path)
        assert run("systemctl", "is-enabled", "castoriceui-backend").stdout.strip() == "enabled"
        run("runuser", "-u", "castoriceui", "--", "python3", "/opt/castoriceui/current/server/run.py", "--config", str(config_path), "--generate-bootstrap")
    else:
        accepted = {"version": version}
    cookie = csrf = ""
    def call(method, path, payload=None):
        nonlocal cookie, csrf
        connection = http.client.HTTPSConnection("127.0.0.1", 443, context=ssl._create_unverified_context(), timeout=12)
        headers = {"Content-Type": "application/json", "Cookie": cookie, "X-CastoriceUI-Request": "1", "X-CSRF-Token": csrf}
        connection.request(method, path, json.dumps(payload) if payload else None, headers)
        response = connection.getresponse(); raw = response.read()
        data = json.loads(raw) if raw else {}
        if response.getheader("Set-Cookie"):
            cookie = response.getheader("Set-Cookie").split(";", 1)[0]
        if data.get("csrfToken"):
            csrf = data["csrfToken"]
        status = response.status; connection.close()
        return status, data
    assert call("GET", "/api/v2/health")[1]["version"] == version
    assert call("GET", "/api/v2/dashboard")[0] == 401
    if args.phase == "install":
        token = Path("/var/lib/castoriceui/bootstrap-token").read_text().strip()
        assert call("POST", "/api/v2/auth/initialize", {"bootstrapToken": token, "username": "qa-admin", "password": "Synthetic-Password-123!"})[0] == 201
        assert call("POST", "/api/v2/initialization/complete")[0] == 409
        assert call("PUT", "/api/v2/integrations/system", {"enabled": True, "values": {"nodeName": "QA VM"}})[0] == 200
        assert call("PUT", "/api/v2/integrations/traffic", {"enabled": True, "values": {"quotaGb": "1000"}})[0] == 200
        assert call("POST", "/api/v2/initialization/complete")[0] == 200
    else:
        status, session = call("POST", "/api/v2/auth/login", {"username": "qa-admin", "password": "Synthetic-Password-123!"})
        assert status == 200 and session["setupComplete"] is True
    assert call("GET", "/api/v2/dashboard")[0] == 200
    assert call("POST", "/api/v2/auth/logout")[0] == 200
    assert call("GET", "/api/v2/auth/session")[0] == 401
    if args.phase == "install":
        previous = {path: path.resolve() for path in (Path("/opt/castoriceui/current"), Path("/var/www/castorice-ui/current"))}
        original_copy, original_link, original_health, original_backup = module.shutil.copytree, module.link, module.health, module.backup_database
        for failure in ("copy", "switch", "nginx", "startup", "health", "restore"):
            fired = [False]
            rollback_armed = [False]
            def fail_once(label):
                if failure == label and not fired[0]:
                    fired[0] = True
                    raise RuntimeError("Synthetic " + label + " failure")
            def copy(*arguments, **kwargs):
                fail_once("copy")
                return original_copy(*arguments, **kwargs)
            def switch(target, destination):
                if destination == Path("/var/www/castorice-ui/current"):
                    fail_once("switch")
                return original_link(target, destination)
            def checked_command(*arguments, **kwargs):
                if arguments == ("nginx", "-t"):
                    fail_once("nginx")
                if arguments[:3] == ("systemctl", "restart", "castoriceui-backend.service"):
                    fail_once("startup")
                return real_command(*arguments, **kwargs)
            def checked_health(config, expected=None):
                if expected == version and not rollback_armed[0] and failure in {"health", "restore"}:
                    rollback_armed[0] = True
                    with sqlite3.connect(config.database_path) as connection:
                        connection.execute("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES('synthetic_rollback_marker','true',datetime('now'))")
                    fail_once("health")
                    raise RuntimeError("Synthetic health failure to exercise restore")
                return original_health(config, expected)
            def checked_backup(source, target):
                if source.is_relative_to("/var/backups"):
                    fail_once("restore")
                return original_backup(source, target)
            module.shutil.copytree, module.link, module.command, module.health = copy, switch, checked_command, checked_health
            module.backup_database = checked_backup
            try:
                module.install(args.archive, config_path)
                raise AssertionError("Failure injection did not abort: " + failure)
            except RuntimeError:
                assert fired[0]
            finally:
                module.shutil.copytree, module.link, module.command, module.health = original_copy, original_link, real_command, original_health
                module.backup_database = original_backup
            if failure == "restore":
                transaction = max(Path("/var/backups").glob("castoriceui-v*/transaction.json"), key=lambda path: path.stat().st_mtime_ns)
                evidence = json.loads(transaction.read_text())
                assert evidence["phase"] == "rollback-failed" and any("restore-database" in item for item in evidence["rollbackErrors"])
                run("systemctl", "stop", "castoriceui-backend")
                original_backup(transaction.parent / "state.db", Path("/var/lib/castoriceui/state.db"))
                run("systemctl", "start", "castoriceui-backend")
                from castoriceui.config import AppConfig
                original_health(AppConfig.load(config_path), version)
            assert all(path.resolve() == target for path, target in previous.items()), failure
            assert call("GET", "/api/v2/health")[1]["version"] == version, failure
            assert run("systemctl", "is-enabled", "castoriceui-backend").stdout.strip() == "enabled", failure
            with sqlite3.connect("/var/lib/castoriceui/state.db") as connection:
                assert connection.execute("SELECT value FROM settings WHERE key='synthetic_rollback_marker'").fetchone() is None
        module.install(args.archive, config_path)
    with sqlite3.connect("file:/var/lib/castoriceui/state.db?mode=ro", uri=True) as database:
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    run("nginx", "-t")
    assert run("systemctl", "is-active", "castoriceui-backend").stdout.strip() == "active"
    print(json.dumps({"phase": args.phase, "version": version, "customConfigAndPort": True, "freshInstallRollbackRetry": args.phase == "install", "realHttpsInitializationOrLogin": True, "sqliteIntegrity": "ok"}))


if __name__ == "__main__":
    main()
